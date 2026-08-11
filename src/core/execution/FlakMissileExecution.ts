import { Execution, Game, Player, Unit, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PathFinding } from "../pathfinding/PathFinder";
import { PathStatus, SteppingPathFinder } from "../pathfinding/types";

export class FlakMissileExecution implements Execution {
  private active = true;
  private pathFinder: SteppingPathFinder<TileRef>;
  private flak: Unit | undefined;
  private mg: Game;
  private speed: number = 0;

  constructor(
    private spawn: TileRef,
    private _owner: Player,
    private ownerUnit: Unit,
    private target: Unit,
    private targetTile: TileRef,
  ) {}

  init(mg: Game, ticks: number): void {
    this.pathFinder = PathFinding.Air(mg);
    this.mg = mg;
    this.speed = this.mg.config().defaultFlakMissileSpeed();
    this.tick(ticks);
  }

  tick(ticks: number): void {
    this.flak ??= this._owner.buildUnit(UnitType.FlakMissile, this.spawn, {
      targetUnit: this.target,
    });
    if (!this.flak.isActive()) {
      this.active = false;
      return;
    }
    if (
      !this.target.isActive() ||
      !this.ownerUnit.isActive() ||
      this.target.owner() === this.flak.owner() ||
      this.target.type() !== UnitType.Bomber
    ) {
      this.flak.delete(false);
      this.active = false;
      return;
    }
    for (let i = 0; i < this.speed; i++) {
      const result = this.pathFinder.next(this.flak.tile(), this.targetTile);
      if (result.status === PathStatus.COMPLETE) {
        this.active = false;
        this.target.delete(true, this._owner);
        this.flak.delete(false);
        return;
      } else if (result.status === PathStatus.NEXT) {
        this.flak.move(result.node);
      }
    }
  }

  isActive(): boolean {
    return this.active;
  }
  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
