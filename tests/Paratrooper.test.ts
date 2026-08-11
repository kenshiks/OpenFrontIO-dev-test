import { AirDefenceExecution } from "../src/core/execution/AirDefenceExecution";
import { AirportExecution } from "../src/core/execution/AirportExecution";
import { ParatrooperExecution } from "../src/core/execution/ParatrooperExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { TileRef } from "../src/core/game/GameMap";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

let game: Game;
let attacker: Player;

function newPlayer(mg: Game, id: string): Player {
  mg.addPlayer(new PlayerInfo(id, PlayerType.Human, null, id));
  return mg.player(id);
}

describe("Paratrooper", () => {
  beforeEach(async () => {
    game = await setup("plains", { infiniteGold: true, instantBuild: true });
    attacker = newPlayer(game, "attacker_id");
    attacker.conquer(game.ref(1, 1));
    attacker.addTroops(10_000);

    const airport = attacker.buildUnit(UnitType.Airport, game.ref(1, 1), {});
    game.addExecution(new AirportExecution(airport));
    game.executeNextTick();
  });

  test("costs no gold, only troops", () => {
    const goldBefore = attacker.gold();

    game.addExecution(new ParatrooperExecution(attacker, game.ref(1, 1)));
    executeTicks(game, 2);

    expect(attacker.gold()).toBe(goldBefore);
  });

  test("reinforces the attacker's own disconnected territory without a malus", () => {
    const exclave = game.ref(80, 80);
    attacker.conquer(exclave);
    const troopsBefore = attacker.troops();

    game.addExecution(new ParatrooperExecution(attacker, exclave));
    executeTicks(game, 30);

    expect(attacker.units(UnitType.Paratrooper)).toHaveLength(0);
    // Every dropped trooper arrives home; unlike a boat this was a
    // deliberate reinforcement, not a retreat, so nothing is lost in transit.
    expect(attacker.troops()).toBeCloseTo(troopsBefore, 0);
    expect(game.owner(exclave)).toBe(attacker);
  });

  test("landing on enemy territory claims a beachhead and reduces the defender's territory", () => {
    const defender = newPlayer(game, "defender_id");
    const targetTile = game.ref(80, 80);
    // A small blob, not a single tile: the beachhead only takes the landing
    // tile, so there's real defender territory left for the attack to fight.
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        defender.conquer(game.ref(80 + dx, 80 + dy));
      }
    }
    defender.addTroops(10_000);
    const tilesBefore = defender.numTilesOwned();

    game.addExecution(new ParatrooperExecution(attacker, targetTile));
    executeTicks(game, 30);

    expect(attacker.units(UnitType.Paratrooper)).toHaveLength(0);
    // The landing tile itself becomes an attacker beachhead...
    expect(game.owner(targetTile)).toBe(attacker);

    for (let i = 0; i < 200 && attacker.outgoingAttacks().length > 0; i++) {
      game.executeNextTick();
    }

    // ...and the dropped troops fought into the rest of the defender's
    // territory, not just absorbed as a free, uncontested capture.
    expect(defender.numTilesOwned()).toBeLessThan(tilesBefore);
  });

  test("air defence shoots down an inbound paratrooper before it lands", () => {
    const defender = newPlayer(game, "defender_id");
    const targetTile = game.ref(80, 80);
    defender.conquer(targetTile);
    defender.addTroops(10_000);
    const airDefence = defender.buildUnit(UnitType.AirDefence, targetTile, {});
    game.addExecution(new AirDefenceExecution(defender, null, airDefence));
    executeTicks(game, 2);

    const troopsBefore = defender.troops();
    const attackerTroopsBefore = attacker.troops();

    game.addExecution(new ParatrooperExecution(attacker, targetTile));
    executeTicks(game, 2);
    expect(attacker.units(UnitType.Paratrooper)).toHaveLength(1);

    executeTicks(game, 30);

    // Shot down mid-flight: never lands, defender is untouched, and the
    // troops it carried (already deducted from the attacker at launch) are
    // simply lost, same as a destroyed Bomber's payload.
    expect(attacker.units(UnitType.Paratrooper)).toHaveLength(0);
    expect(defender.troops()).toBe(troopsBefore);
    expect(game.owner(targetTile)).toBe(defender);
    expect(attacker.troops()).toBeLessThan(attackerTroopsBefore);
  });

  test("cannot paradrop onto water", async () => {
    const waterGame = await setup("ocean_and_land", {
      infiniteGold: true,
      instantBuild: true,
    });
    const player = newPlayer(waterGame, "attacker_id");
    player.conquer(waterGame.ref(1, 1));
    player.addTroops(10_000);
    const airport = player.buildUnit(UnitType.Airport, waterGame.ref(1, 1), {});
    waterGame.addExecution(new AirportExecution(airport));
    waterGame.executeNextTick();

    let waterTile: TileRef | null = null;
    for (let x = 0; x < waterGame.width() && waterTile === null; x++) {
      for (let y = 0; y < waterGame.height(); y++) {
        const t = waterGame.ref(x, y);
        if (!waterGame.isLand(t)) {
          waterTile = t;
          break;
        }
      }
    }
    expect(waterTile).not.toBeNull();

    const troopsBefore = player.troops();
    waterGame.addExecution(new ParatrooperExecution(player, waterTile!));
    executeTicks(waterGame, 5);

    expect(player.units(UnitType.Paratrooper)).toHaveLength(0);
    expect(player.troops()).toBe(troopsBefore);
  });
});
