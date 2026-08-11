import {
  Game,
  Gold,
  Player,
  PlayerType,
  Structures,
  UnitType,
} from "../../game/Game";
import { TileRef } from "../../game/GameMap";
import { PseudoRandom } from "../../PseudoRandom";
import { BomberExecution } from "../BomberExecution";
import { ParatrooperExecution } from "../ParatrooperExecution";
import { AiAttackBehavior } from "../utils/AiAttackBehavior";
import { NationNukeBehavior } from "./NationNukeBehavior";
import { randTerritoryTileArray } from "./NationUtils";

/** How many random tiles to sample when looking for a strike target inside enemy territory. */
const TARGET_SAMPLE_SIZE = 15;

/** Minimum troop count before a paratrooper drop is considered worthwhile. */
const MIN_TROOPS_FOR_PARATROOPER = 1000;

/**
 * Simple bot usage of Airport-launched units. Deliberately much simpler than
 * NationNukeBehavior (no SAM-avoidance trajectory planning, no cost-saving
 * simulation): it reuses NationNukeBehavior's target selection — who to hit
 * is the same nuke-targeting question, just with a cheaper, more
 * interceptable weapon — and picks a strike tile with a simple "best
 * structure, else random territory tile" search, mirroring
 * AiAttackBehavior.findRandomBoatTarget's sampling approach.
 */
export class NationBomberBehavior {
  constructor(
    private random: PseudoRandom,
    private game: Game,
    private player: Player,
    private nukeBehavior: NationNukeBehavior,
    private attackBehavior: AiAttackBehavior,
  ) {}

  maybeSendBomber(): void {
    const config = this.game.config();
    if (config.isUnitDisabled(UnitType.Bomber)) return;
    if (this.player.units(UnitType.Bomber).length > 0) return;
    if (!this.hasReadyAirport()) return;
    if (this.player.gold() < this.cost(UnitType.Bomber)) return;

    const target = this.findTarget();
    if (target === null) return;

    const tile = this.findStrikeTile(target, UnitType.Bomber);
    if (tile === null) return;

    this.game.addExecution(new BomberExecution(this.player, tile));
  }

  maybeSendParatrooper(): void {
    const config = this.game.config();
    if (config.isUnitDisabled(UnitType.Paratrooper)) return;
    if (this.player.units(UnitType.Paratrooper).length > 0) return;
    if (!this.hasReadyAirport()) return;
    // Needs a meaningful chunk of troops to be worth dropping — mirrors the
    // 1/5-of-troops boats send in AiAttackBehavior.attackWithRandomBoat.
    if (this.player.troops() < MIN_TROOPS_FOR_PARATROOPER) return;

    const target = this.findTarget();
    if (target === null) return;

    const tile = this.findStrikeTile(target, UnitType.Paratrooper);
    if (tile === null) return;

    this.game.addExecution(new ParatrooperExecution(this.player, tile));
  }

  private hasReadyAirport(): boolean {
    return this.player
      .units(UnitType.Airport)
      .some(
        (a) => a.isActive() && !a.isInCooldown() && !a.isUnderConstruction(),
      );
  }

  /** Reuses NationNukeBehavior's target selection (retaliation, crown, hated player, ...). */
  private findTarget(): Player | null {
    const target = this.nukeBehavior.findBestNukeTarget();
    if (target === null) return null;
    if (target.type() === PlayerType.Bot) return null;
    if (this.player.isOnSameTeam(target)) return null;
    if (!this.attackBehavior.shouldAttack(target)) return null;
    return target;
  }

  /**
   * Picks a strike tile inside the target's territory: prefers their
   * highest-level structure, falls back to a random sample of their land.
   */
  private findStrikeTile(target: Player, unitType: UnitType): TileRef | null {
    const structures = target.units(Structures.types);
    if (structures.length > 0) {
      const best = structures.reduce((a, b) => (b.level() > a.level() ? b : a));
      if (this.player.canBuild(unitType, best.tile()) !== false) {
        return best.tile();
      }
    }
    const tiles = randTerritoryTileArray(
      this.random,
      this.game,
      target,
      TARGET_SAMPLE_SIZE,
    );
    for (const tile of tiles) {
      if (this.player.canBuild(unitType, tile) !== false) {
        return tile;
      }
    }
    return null;
  }

  private cost(type: UnitType): Gold {
    return this.game.unitInfo(type).cost(this.game, this.player);
  }
}
