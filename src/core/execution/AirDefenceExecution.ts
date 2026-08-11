import { Execution, Game, isUnit, Player, Unit, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { FlakMissileExecution } from "./FlakMissileExecution";

type Target = {
  unit: Unit;
  tile: TileRef;
};

type InterceptionTile = {
  tile: TileRef;
  tick: number;
};

const INTERCEPTABLE_AIRCRAFT = [UnitType.Bomber, UnitType.Paratrooper] as const;

/**
 * Targeting system for an Air Defence structure: preshoots incoming aircraft
 * (bombers, paratroopers) along their known flight path so its range is
 * strictly enforced. Mirrors SAMLauncherExecution's SAMTargetingSystem, but
 * against aircraft instead of nukes.
 */
class AirDefenceTargetingSystem {
  private readonly precomputedBombers: Map<number, InterceptionTile | null> =
    new Map();
  private readonly missileSpeed: number;

  constructor(
    private readonly mg: Game,
    private readonly airDefence: Unit,
  ) {
    this.missileSpeed = this.mg.config().defaultFlakMissileSpeed();
  }

  private updateUnreachableBombers(
    nearbyUnits: { unit: Unit; distSquared: number }[],
  ) {
    if (this.precomputedBombers.size === 0) {
      return;
    }
    const nearbySet = new Set(nearbyUnits.map((u) => u.unit.id()));
    for (const bomberId of this.precomputedBombers.keys()) {
      if (!nearbySet.has(bomberId)) {
        this.precomputedBombers.delete(bomberId);
      }
    }
  }

  private tickToReach(currentTile: TileRef, tile: TileRef): number {
    return Math.ceil(
      this.mg.manhattanDist(currentTile, tile) / this.missileSpeed,
    );
  }

  private computeInterceptionTile(
    unit: Unit,
    defenceTile: TileRef,
    rangeSquared: number,
  ): InterceptionTile | undefined {
    const trajectory = unit.trajectory();
    const currentIndex = unit.trajectoryIndex();

    // BomberExecution/ParatrooperExecution run before AirDefenceExecution;
    // it cannot intercept the final tick.
    const maxInterceptionIndex = trajectory.length - 2;
    for (let i = currentIndex; i <= maxInterceptionIndex; i++) {
      const trajectoryTile = trajectory[i];
      if (
        this.mg.euclideanDistSquared(defenceTile, trajectoryTile.tile) <=
        rangeSquared
      ) {
        const bomberTickToReach = i - currentIndex;
        const defenceTickToReach = this.tickToReach(
          defenceTile,
          trajectoryTile.tile,
        );
        const tickBeforeShooting = bomberTickToReach - defenceTickToReach;
        if (tickBeforeShooting >= 0) {
          return { tick: tickBeforeShooting, tile: trajectoryTile.tile };
        }
      }
    }

    const finalTile = trajectory[trajectory.length - 1];
    if (
      finalTile &&
      this.mg.euclideanDistSquared(defenceTile, finalTile.tile) <= rangeSquared
    ) {
      const targetInFlightTile = trajectory[maxInterceptionIndex];
      if (targetInFlightTile) {
        const bomberTickToReach = maxInterceptionIndex - currentIndex;
        const defenceTickToReach = this.tickToReach(
          defenceTile,
          targetInFlightTile.tile,
        );
        const tickBeforeShooting = bomberTickToReach - defenceTickToReach;
        if (tickBeforeShooting >= 0) {
          return { tick: tickBeforeShooting, tile: targetInFlightTile.tile };
        }
      }
    }

    return undefined;
  }

  public getValidTargets(ticks: number): Target[] {
    const defenceTile = this.airDefence.tile();
    const range = this.mg.config().airDefenceRange();
    const rangeSquared = range * range;
    const detectionRange = range * 2;

    const bombers = this.mg.nearbyUnits(
      defenceTile,
      detectionRange,
      INTERCEPTABLE_AIRCRAFT,
      ({ unit }) => isUnit(unit) && unit.owner() !== this.airDefence.owner(),
    );

    this.updateUnreachableBombers(bombers);

    const targets: Target[] = [];
    for (const bomber of bombers) {
      const bomberId = bomber.unit.id();
      const cached = this.precomputedBombers.get(bomberId);
      if (cached !== undefined) {
        if (cached === null) {
          continue;
        }
        if (cached.tick === ticks || cached.tick === ticks + 1) {
          targets.push({ tile: cached.tile, unit: bomber.unit });
          this.precomputedBombers.delete(bomberId);
          continue;
        }
        if (cached.tick > ticks) {
          continue;
        }
        this.precomputedBombers.delete(bomberId);
      }
      const interceptionTile = this.computeInterceptionTile(
        bomber.unit,
        defenceTile,
        rangeSquared,
      );
      if (interceptionTile !== undefined) {
        if (interceptionTile.tick <= 1) {
          targets.push({ unit: bomber.unit, tile: interceptionTile.tile });
        } else {
          this.precomputedBombers.set(bomberId, {
            tick: interceptionTile.tick + ticks,
            tile: interceptionTile.tile,
          });
        }
      } else {
        this.precomputedBombers.set(bomberId, null);
      }
    }

    return targets;
  }
}

export class AirDefenceExecution implements Execution {
  private mg: Game;
  private active: boolean = true;

  private targetingSystem: AirDefenceTargetingSystem;

  constructor(
    private player: Player,
    private tile: TileRef | null,
    private airDefence: Unit | null = null,
  ) {
    if (airDefence !== null) {
      this.tile = airDefence.tile();
    }
  }

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    if (this.mg === null || this.player === null) {
      throw new Error("Not initialized");
    }
    if (this.airDefence === null) {
      if (this.tile === null) {
        throw new Error("tile is null");
      }
      const spawnTile = this.player.canBuild(UnitType.AirDefence, this.tile);
      if (spawnTile === false) {
        console.warn("cannot build Air Defence");
        this.active = false;
        return;
      }
      this.airDefence = this.player.buildUnit(
        UnitType.AirDefence,
        spawnTile,
        {},
      );
    }
    this.targetingSystem ??= new AirDefenceTargetingSystem(
      this.mg,
      this.airDefence,
    );

    if (this.airDefence.isUnderConstruction()) {
      return;
    }

    if (!this.airDefence.isActive()) {
      this.active = false;
      return;
    }

    if (this.player !== this.airDefence.owner()) {
      this.player = this.airDefence.owner();
    }

    const frontTime = this.airDefence.missileTimerQueue()[0];
    if (frontTime !== undefined) {
      const cooldown =
        this.mg.config().airDefenceCooldown() - (this.mg.ticks() - frontTime);
      if (cooldown <= 0) {
        this.airDefence.reloadMissile();
      }
    }
    if (this.airDefence.isInCooldown()) {
      return;
    }

    const targets = this.targetingSystem.getValidTargets(ticks);
    for (const target of targets) {
      if (this.airDefence.isInCooldown()) {
        break;
      }
      this.airDefence.launch();
      this.mg.addExecution(
        new FlakMissileExecution(
          this.airDefence.tile(),
          this.airDefence.owner(),
          this.airDefence,
          target.unit,
          target.tile,
        ),
      );
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
