import { Execution, Game, Unit } from "../game/Game";

export class AirportExecution implements Execution {
  private active = true;
  private mg: Game;
  private airport: Unit;

  constructor(airport: Unit) {
    this.airport = airport;
  }

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    if (this.airport.isUnderConstruction()) {
      return;
    }

    if (!this.airport.isActive()) {
      this.active = false;
      return;
    }

    // frontTime is the time the earliest bomber launched.
    const frontTime = this.airport.missileTimerQueue()[0];
    if (frontTime === undefined) {
      return;
    }

    const cooldown =
      this.mg.config().airportCooldown() - (this.mg.ticks() - frontTime);

    if (cooldown <= 0) {
      this.airport.reloadMissile();
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
