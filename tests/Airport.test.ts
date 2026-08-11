import { AirportExecution } from "../src/core/execution/AirportExecution";
import { BomberExecution } from "../src/core/execution/BomberExecution";
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

function attackerBuildsBomber(target: TileRef, initialize = true) {
  game.addExecution(new BomberExecution(attacker, target));
  if (initialize) {
    game.executeNextTick();
    game.executeNextTick();
  }
}

describe("Airport", () => {
  beforeEach(async () => {
    game = await setup("plains", { infiniteGold: true, instantBuild: true });

    const attackerInfo = new PlayerInfo(
      "attacker_id",
      PlayerType.Human,
      null,
      "attacker_id",
    );
    game.addPlayer(attackerInfo);
    attacker = game.player("attacker_id");
    attacker.conquer(game.ref(1, 1));

    const airport = attacker.buildUnit(UnitType.Airport, game.ref(1, 1), {});
    game.addExecution(new AirportExecution(airport));
    game.executeNextTick();
  });

  test("airport should launch a bomber that is consumed on impact", async () => {
    attackerBuildsBomber(game.ref(7, 7));
    expect(attacker.units(UnitType.Bomber)).toHaveLength(1);

    executeTicks(game, 20);

    expect(attacker.units(UnitType.Bomber)).toHaveLength(0);
  });

  test("airport should only launch one bomber at a time", async () => {
    // Far enough away that the first bomber is still in flight (not yet
    // detonated) by the time we check.
    attackerBuildsBomber(game.ref(50, 50));
    attackerBuildsBomber(game.ref(50, 50));
    expect(attacker.units(UnitType.Bomber)).toHaveLength(1);
  });

  test("airport should cooldown as long as configured", async () => {
    expect(attacker.units(UnitType.Airport)[0].isInCooldown()).toBeFalsy();
    // Send the bomber far enough away that it doesn't level the airport itself.
    attackerBuildsBomber(game.ref(50, 50));
    expect(attacker.units(UnitType.Bomber)).toHaveLength(1);

    for (let i = 0; i < game.config().airportCooldown() - 2; i++) {
      game.executeNextTick();
      expect(
        attacker.units(UnitType.Airport)[0].isInCooldown(),
      ).toBeTruthy();
    }

    executeTicks(game, 2);

    expect(attacker.units(UnitType.Airport)[0].isInCooldown()).toBeFalsy();
  });

  test("bombing damages troops without changing tile ownership", async () => {
    const defenderInfo = new PlayerInfo(
      "defender_id",
      PlayerType.Human,
      null,
      "defender_id",
    );
    game.addPlayer(defenderInfo);
    const defender = game.player("defender_id");
    const targetTile = game.ref(50, 50);
    defender.conquer(targetTile);
    defender.addTroops(10_000);
    const troopsBefore = defender.troops();

    attackerBuildsBomber(targetTile);
    executeTicks(game, 30);

    expect(attacker.units(UnitType.Bomber)).toHaveLength(0);
    expect(game.owner(targetTile)).toBe(defender);
    expect(defender.troops()).toBeLessThan(troopsBefore);
  });

  test("bombing destroys structures within the inner blast radius", async () => {
    const defenderInfo = new PlayerInfo(
      "defender_id",
      PlayerType.Human,
      null,
      "defender_id",
    );
    game.addPlayer(defenderInfo);
    const defender = game.player("defender_id");
    const targetTile = game.ref(50, 50);
    defender.conquer(targetTile);
    const city = defender.buildUnit(UnitType.City, targetTile, {});

    attackerBuildsBomber(targetTile);
    executeTicks(game, 30);

    expect(city.isActive()).toBeFalsy();
    // Conventional bombing never changes tile ownership, unlike a nuke.
    expect(game.owner(targetTile)).toBe(defender);
  });
});
