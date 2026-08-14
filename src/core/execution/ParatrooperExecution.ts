import {
  Execution,
  Game,
  Player,
  TerraNullius,
  TrajectoryTile,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PathFinding } from "../pathfinding/PathFinder";
import { AttackExecution } from "./AttackExecution";

/**
 * Airborne troop delivery from an Airport: flies over anything (no water or
 * border-connectivity constraints, unlike TransportShip) and lands on the
 * target tile, same landing logic as TransportShipExecution. Landing on the
 * attacker's own (possibly disconnected) territory reinforces it directly;
 * landing on a friendly player's territory also just reinforces them;
 * anywhere else, it claims a beachhead and launches an AttackExecution from
 * it. Allied territory can't be chosen as a target in the first place (see
 * PlayerImpl.paratrooperSpawn) — the reinforce-ally path here only matters
 * if an alliance forms mid-flight, after an attack was already launched.
 *
 * A 1 HP aircraft in flight, so AirDefenceExecution can shoot it down before
 * it lands (its troops are simply lost, same as a destroyed Bomber's blast).
 */
export class ParatrooperExecution implements Execution {
  private active = true;
  private mg: Game;
  private plane: Unit | null = null;
  private speed: number;
  private path: TileRef[] = [];
  private pathIndex = 0;
  private target: Player | TerraNullius;
  private troops: number;

  constructor(
    private attacker: Player,
    private dst: TileRef,
    troops?: number,
  ) {
    this.troops = troops ?? -1;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.speed = this.mg.config().defaultParatrooperSpeed();
  }

  tick(ticks: number): void {
    if (this.plane === null) {
      this.target = this.mg.owner(this.dst);

      if (
        this.target.isPlayer() &&
        this.target !== this.attacker &&
        !this.attacker.canAttackPlayer(this.target)
      ) {
        this.active = false;
        return;
      }

      const troops = Math.min(
        this.troops >= 0
          ? this.troops
          : this.mg.config().paratrooperDropAmount(this.attacker, this.target),
        this.attacker.troops(),
      );
      if (troops <= 0) {
        this.active = false;
        return;
      }

      const spawn = this.attacker.canBuild(UnitType.Paratrooper, this.dst);
      if (spawn === false) {
        console.warn("cannot build Paratrooper");
        this.active = false;
        return;
      }

      this.path = PathFinding.Air(this.mg).findPath(spawn, this.dst) ?? [spawn];
      const trajectory: TrajectoryTile[] = this.path.map((tile) => ({
        tile,
        targetable: true,
      }));
      this.plane = this.attacker.buildUnit(UnitType.Paratrooper, spawn, {
        troops,
        targetTile: this.dst,
        trajectory,
      });
      this.pathIndex = 0;
      this.plane.setTrajectoryIndex(0);

      const airport = this.attacker
        .units(UnitType.Airport)
        .find((a) => a.tile() === spawn);
      airport?.launch();

      this.mg.recordMotionPlan({
        kind: "grid",
        unitId: this.plane.id(),
        planId: 1,
        startTick: ticks + 1,
        ticksPerStep: 1,
        path: this.path,
      });
      return;
    }

    if (!this.plane.isActive()) {
      // Shot down by air defence, or otherwise removed.
      this.active = false;
      return;
    }

    this.pathIndex = Math.min(
      this.pathIndex + this.speed,
      this.path.length - 1,
    );
    this.plane.move(this.path[this.pathIndex]);
    this.plane.setTrajectoryIndex(this.pathIndex);

    if (this.pathIndex >= this.path.length - 1) {
      this.land();
    }
  }

  private land(): void {
    if (this.plane === null) {
      throw new Error("Not initialized");
    }
    const troops = this.plane.troops();

    if (this.mg.owner(this.dst) === this.attacker) {
      // Reinforcing our own (possibly disconnected) territory: no malus,
      // this was a deliberate drop, not a retreat.
      this.attacker.addTroops(troops);
    } else {
      this.attacker.conquer(this.dst);
      if (this.target.isPlayer() && this.attacker.isFriendly(this.target)) {
        this.attacker.addTroops(troops);
      } else {
        this.mg.addExecution(
          new AttackExecution(
            troops,
            this.attacker,
            this.target.id(),
            this.dst,
            false,
          ),
        );
      }
    }

    this.plane.delete(false);
    this.active = false;
  }

  isActive(): boolean {
    return this.active;
  }
}
