import {
  Execution,
  Game,
  Player,
  Structures,
  TrajectoryTile,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PathFinding } from "../pathfinding/PathFinder";

/**
 * A bomber is a conventional (non-nuclear) strike: it damages troops and
 * flattens nearby structures in its blast radius, but never changes tile
 * ownership the way a nuke does. It has a single hit point, so any
 * interception (see AirDefenceExecution) destroys it outright.
 */
export class BomberExecution implements Execution {
  private active = true;
  private mg: Game;
  private bomber: Unit | null = null;
  private speed: number;
  private path: TileRef[] = [];
  private pathIndex = 0;

  constructor(
    private player: Player,
    private dst: TileRef,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.speed = this.mg.config().defaultBomberSpeed();
  }

  tick(ticks: number): void {
    if (this.bomber === null) {
      const spawn = this.player.canBuild(UnitType.Bomber, this.dst);
      if (spawn === false) {
        console.warn("cannot build Bomber");
        this.active = false;
        return;
      }
      this.path = PathFinding.Air(this.mg).findPath(spawn, this.dst) ?? [
        spawn,
      ];
      const trajectory: TrajectoryTile[] = this.path.map((tile) => ({
        tile,
        targetable: true,
      }));
      this.bomber = this.player.buildUnit(UnitType.Bomber, spawn, {
        targetTile: this.dst,
        trajectory,
      });
      this.pathIndex = 0;
      this.bomber.setTrajectoryIndex(0);

      const airport = this.player
        .units(UnitType.Airport)
        .find((a) => a.tile() === spawn);
      airport?.launch();

      this.mg.recordMotionPlan({
        kind: "grid",
        unitId: this.bomber.id(),
        planId: 1,
        startTick: ticks + 1,
        ticksPerStep: 1,
        path: this.path,
      });
      return;
    }

    if (!this.bomber.isActive()) {
      // Shot down by air defence, or otherwise removed.
      this.active = false;
      return;
    }

    this.pathIndex = Math.min(this.pathIndex + this.speed, this.path.length - 1);
    this.bomber.move(this.path[this.pathIndex]);
    this.bomber.setTrajectoryIndex(this.pathIndex);

    if (this.pathIndex >= this.path.length - 1) {
      this.detonate();
    }
  }

  private detonate(): void {
    if (this.bomber === null) {
      throw new Error("Not initialized");
    }
    const mg = this.mg;
    const { inner, outer } = mg.config().bomberBlastRadius();
    const inner2 = inner * inner;
    const outer2 = outer * outer;

    const blastTiles = mg.bfs(
      this.dst,
      (_, n) => mg.euclideanDistSquared(this.dst, n) <= outer2 && !mg.isImpassable(n),
    );

    const tilesPerPlayer = new Map<Player, number>();
    for (const tile of blastTiles) {
      const owner = mg.owner(tile);
      if (owner.isPlayer()) {
        tilesPerPlayer.set(owner, (tilesPerPlayer.get(owner) ?? 0) + 1);
      }
    }

    const damagePerTile = mg.config().bomberTroopDamageFactor();
    for (const [player, numTiles] of tilesPerPlayer) {
      player.removeTroops(Math.min(player.troops(), damagePerTile * numTiles));
    }

    // Precision strike: only structures near ground zero are levelled.
    for (const unit of mg.units()) {
      if (
        Structures.has(unit.type()) &&
        mg.euclideanDistSquared(this.dst, unit.tile()) <= inner2
      ) {
        unit.delete(true, this.player);
      }
    }

    // Redraw structures across the wider blast so damage/health bars refresh.
    for (const unit of mg.units()) {
      if (
        Structures.has(unit.type()) &&
        mg.euclideanDistSquared(this.dst, unit.tile()) <= outer2
      ) {
        unit.touch();
      }
    }

    this.active = false;
    this.bomber.delete(false);
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
