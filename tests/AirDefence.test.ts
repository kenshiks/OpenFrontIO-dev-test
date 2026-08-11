import { AirDefenceExecution } from "../src/core/execution/AirDefenceExecution";
import { AirportExecution } from "../src/core/execution/AirportExecution";
import { BomberExecution } from "../src/core/execution/BomberExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { setup } from "./util/Setup";
import { TestConfig } from "./util/TestConfig";
import { executeTicks } from "./util/utils";

let game: Game;
let attacker: Player;
let defender: Player;

describe("AirDefence", () => {
  beforeEach(async () => {
    game = await setup("plains", { infiniteGold: true, instantBuild: true });
    // Bomber speed derives from nuke speed (half of it), so pin nuke speed
    // here too, same as tests that care about nuke travel time.
    (game.config() as TestConfig).setDefaultNukeSpeed(20);

    const attackerInfo = new PlayerInfo(
      "attacker_id",
      PlayerType.Human,
      null,
      "attacker_id",
    );
    const defenderInfo = new PlayerInfo(
      "defender_id",
      PlayerType.Human,
      null,
      "defender_id",
    );
    game.addPlayer(attackerInfo);
    game.addPlayer(defenderInfo);

    attacker = game.player("attacker_id");
    defender = game.player("defender_id");

    attacker.conquer(game.ref(1, 1));
    const airport = attacker.buildUnit(UnitType.Airport, game.ref(1, 1), {});
    game.addExecution(new AirportExecution(airport));

    defender.conquer(game.ref(50, 50));
    defender.addTroops(10_000);
    const airDefence = defender.buildUnit(
      UnitType.AirDefence,
      game.ref(50, 50),
      {},
    );
    game.addExecution(new AirDefenceExecution(defender, null, airDefence));

    executeTicks(game, 2);
  });

  test("air defence is ready (not on cooldown) once built", () => {
    expect(defender.units(UnitType.AirDefence)[0].isInCooldown()).toBeFalsy();
  });

  test("air defence shoots down an inbound bomber before it reaches its target", () => {
    const troopsBefore = defender.troops();

    game.addExecution(new BomberExecution(attacker, game.ref(50, 50)));
    executeTicks(game, 2);
    expect(attacker.units(UnitType.Bomber)).toHaveLength(1);

    executeTicks(game, 30);

    // The bomber should have been destroyed in flight rather than reaching
    // its target and detonating.
    expect(attacker.units(UnitType.Bomber)).toHaveLength(0);
    expect(defender.troops()).toBe(troopsBefore);
  });

  test("air defence cannot intercept a second bomber while reloading", () => {
    // Give the attacker a second airport so a follow-up bomber can launch
    // immediately, without waiting on the first airport's own cooldown.
    attacker.conquer(game.ref(2, 2));
    const secondAirport = attacker.buildUnit(
      UnitType.Airport,
      game.ref(2, 2),
      {},
    );
    game.addExecution(new AirportExecution(secondAirport));
    executeTicks(game, 2);

    // First bomber gets shot down, putting air defence on cooldown.
    game.addExecution(new BomberExecution(attacker, game.ref(50, 50)));
    executeTicks(game, 30);
    expect(attacker.units(UnitType.Bomber)).toHaveLength(0);
    expect(defender.units(UnitType.AirDefence)[0].isInCooldown()).toBeTruthy();

    const troopsBefore = defender.troops();

    // A second bomber, launched from the still-ready second airport, should
    // get through while air defence reloads.
    game.addExecution(new BomberExecution(attacker, game.ref(50, 50)));
    executeTicks(game, 30);

    expect(attacker.units(UnitType.Bomber)).toHaveLength(0);
    expect(defender.troops()).toBeLessThan(troopsBefore);
  });
});
