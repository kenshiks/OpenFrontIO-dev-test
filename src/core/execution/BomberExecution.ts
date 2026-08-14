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
import { listNukeBreakAlliance } from "./Util";

/**
 * A bomber is a conventional (non-nuclear) strike: it damages troops and
 * flattens nearby structures in its blast radius. Land within the inner
 * radius is relinquished to neutral, same as a nuke's impact zone — the
 * attacker doesn't automatically capture it, it just has to be retaken.
 * It has a single hit point, so any interception (see AirDefenceExecution)
 * destroys it outright.
 *
 * Bombing a significant chunk of an ally's territory (or any of their
 * structures) breaks the alliance and marks the attacker a traitor, same
 * as nuking one does — diplomatically a bomber is just as much of a
 * declaration of war as a nuke.
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
      this.path = PathFinding.Air(this.mg).findPath(spawn, this.dst) ?? [spawn];
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
      this.maybeBreakAlliances();

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

    this.pathIndex = Math.min(
      this.pathIndex + this.speed,
      this.path.length - 1,
    );
    this.bomber.move(this.path[this.pathIndex]);
    this.bomber.setTrajectoryIndex(this.pathIndex);

    if (this.pathIndex >= this.path.length - 1) {
      this.detonate();
    }
  }

  /**
   * Break alliances with players significantly affected by the strike.
   * Same rule and threshold as NukeExecution.maybeBreakAlliances(): weighted
   * tile counting (inner=1, outer=0.5), or any allied structure in blast.
   */
  private maybeBreakAlliances(): void {
    const magnitude = this.mg.config().bomberBlastRadius();
    const playersToBreakAllianceWith = listNukeBreakAlliance({
      game: this.mg,
      targetTile: this.dst,
      magnitude,
      threshold: this.mg.config().nukeAllianceBreakThreshold(),
    });

    // Automatically reject incoming alliance requests.
    for (const incoming of this.player.incomingAllianceRequests()) {
      if (playersToBreakAllianceWith.has(incoming.requestor().smallID())) {
        incoming.reject();
      }
    }

    for (const playerSmallId of playersToBreakAllianceWith) {
      const attackedPlayer = this.mg.playerBySmallID(playerSmallId);
      if (!attackedPlayer.isPlayer()) {
        continue;
      }

      // Resolves exploit of alliance breaking in which a pending alliance
      // request was accepted in the middle of a bombing run.
      const outgoingAllianceRequest = attackedPlayer
        .incomingAllianceRequests()
        .find((ar) => ar.requestor() === this.player);
      if (outgoingAllianceRequest) {
        outgoingAllianceRequest.reject();
        continue;
      }

      const alliance = this.player.allianceWith(attackedPlayer);
      if (alliance !== null) {
        this.player.breakAlliance(alliance);
      }
      if (attackedPlayer !== this.player) {
        attackedPlayer.updateRelation(this.player, -100);
      }
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
      (_, n) =>
        mg.euclideanDistSquared(this.dst, n) <= outer2 && !mg.isImpassable(n),
    );

    const tilesPerPlayer = new Map<Player, number>();
    for (const tile of blastTiles) {
      const owner = mg.owner(tile);
      if (owner.isPlayer()) {
        tilesPerPlayer.set(owner, (tilesPerPlayer.get(owner) ?? 0) + 1);
        // Ground zero itself reverts to neutral; the rest of the blast
        // (troop damage, structure destruction) reaches further out.
        if (mg.euclideanDistSquared(this.dst, tile) <= inner2) {
          owner.relinquish(tile);
        }
      }
    }

    const damagePerTile = mg.config().bomberTroopDamageFactor();
    for (const [player, numTiles] of tilesPerPlayer) {
      player.removeTroops(Math.min(player.troops(), damagePerTile * numTiles));
    }

    // Precision strike: only structures near ground zero are levelled.
    // Spatial query instead of scanning every unit on the map. Structures
    // under construction are included too, same as the original full scan.
    for (const { unit, distSquared } of mg.nearbyUnits(
      this.dst,
      outer,
      Structures.types,
      undefined,
      true,
    )) {
      if (distSquared <= inner2) {
        unit.delete(true, this.player);
      }
    }

    // Redraw structures across the wider blast so damage/health bars refresh.
    for (const { unit, distSquared } of mg.nearbyUnits(
      this.dst,
      outer,
      Structures.types,
      undefined,
      true,
    )) {
      if (distSquared <= outer2) {
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
