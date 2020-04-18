import { TestSuiteInfo, TestSuiteEvent } from 'vscode-test-adapter-api';

import { generateId, milisecToStr, reverse } from './Util';
import { SharedVariables } from './SharedVariables';
import { AbstractTest } from './AbstractTest';

///

export class Suite implements TestSuiteInfo {
  public readonly type: 'suite' = 'suite';
  public readonly id: string;
  public children: (Suite | AbstractTest)[] = [];
  protected _runningCounter = 0;

  public constructor(
    protected readonly _shared: SharedVariables,
    public readonly parent: Suite | undefined,
    private readonly _label: string,
    private readonly _description: string | undefined,
    id: string | undefined | Suite,
  ) {
    this.id = id === undefined ? generateId() : typeof id === 'string' ? id : id.id;
  }

  public get label(): string {
    return this._label;
  }

  public get description(): string | undefined {
    return this._description;
  }

  public get tooltip(): string {
    return 'Name: ' + this._label + (this._description ? '\nDescription: ' + this._description : '');
  }

  public get file(): string | undefined {
    this._calculateFileAndLine();
    return this._file!;
  }

  public get line(): number | undefined {
    this._calculateFileAndLine();
    return this._line!;
  }

  private _file: null | string | undefined = null; // null means has to be calculated
  private _line: null | number | undefined = null; // null means has to be calculated

  private _calculateFileAndLine(): void {
    if (this._file === null || this._line === null) {
      this._file = undefined;
      this._line = undefined;

      if (this.children.length === 0) return;

      const children = this.children.map(v => {
        return {
          file: v.file,
          line: v.line,
        };
      });

      if (children.some(v => children[0].file !== v.file)) return;

      this._file = children[0].file;

      if (this._file === undefined) return;

      this._line = children
        .filter(v => v.line !== undefined)
        .reduce(
          (prev, curr) => (curr.line === undefined ? prev : prev === 0 ? curr.line : Math.min(prev, curr.line)),
          0,
        );
    }
  }

  private _getRunningEvent(): TestSuiteEvent {
    return { type: 'suite', suite: this, state: 'running' };
  }

  public sendRunningEventIfNeeded(): void {
    if (this._runningCounter++ === 0) {
      this._shared.log.localDebug('Suite running event fired', this.label);
      this._shared.testStatesEmitter.fire(this._getRunningEvent());
    }
  }

  private _getCompletedEvent(): TestSuiteEvent {
    let testCount = 0;
    let durationSum: number | undefined = undefined;
    const stateStat: { [prop: string]: number } = {};

    this.enumerateTestInfos((test: AbstractTest) => {
      testCount++;
      if (test.lastRunMilisec !== undefined) durationSum = (durationSum ? durationSum : 0) + test.lastRunMilisec;
      if (test.lastRunEvent) {
        if (test.lastRunEvent.state in stateStat) stateStat[test.lastRunEvent.state]++;
        else stateStat[test.lastRunEvent.state] = 1;
      }
    });

    let description: string | undefined = undefined;
    let tooltip: string | undefined = undefined;

    if (durationSum !== undefined) {
      const durationStr = milisecToStr(durationSum);

      description = (this.description ? this.description + ' ' : '') + '(' + durationStr + ')';

      tooltip =
        this.tooltip +
        '\n\n' +
        'Tests: ' +
        testCount +
        '\n' +
        Object.keys(stateStat)
          .map(state => '  - ' + state + ': ' + stateStat[state])
          .join('\n') +
        '\n⏱Duration: ' +
        durationStr;
    }

    return { type: 'suite', suite: this, state: 'completed', description, tooltip };
  }

  public sendCompletedEventIfNeeded(): void {
    if (this._runningCounter < 1) {
      this._shared.log.error('Suite running counter is too low');
      this._runningCounter = 0;
      return;
    }
    if (this._runningCounter-- === 1) {
      this._shared.log.localDebug('Suite completed event fired', this.label);
      this._shared.testStatesEmitter.fire(this._getCompletedEvent());
    }
  }

  public sendMinimalEventsIfNeeded(completed: Suite[], running: Suite[]): void {
    if (completed.length === 0) {
      reverse(running)(v => v.sendRunningEventIfNeeded());
    } else if (running.length === 0) {
      completed.forEach(v => v.sendCompletedEventIfNeeded());
    } else if (completed[0] === running[0]) {
      if (completed.length !== running.length) this._shared.log.error('completed.length !== running.length');
    } else {
      let completedIndex = -1;
      let runningIndex = -1;

      do {
        ++completedIndex;
        runningIndex = running.indexOf(completed[completedIndex]);
      } while (completedIndex < completed.length && runningIndex === -1);

      for (let i = 0; i < completedIndex; ++i) completed[i].sendCompletedEventIfNeeded();
      for (let i = runningIndex - 1; i >= 0; --i) running[i].sendRunningEventIfNeeded();
    }
  }

  protected _addChild(child: Suite | AbstractTest): void {
    if (this.children.indexOf(child) != -1) {
      this._shared.log.error('should not try to add the child twice', this, child);
      return;
    }

    this._file = null;
    this._line = null;

    this.children.push(child);
  }

  public addTest(child: AbstractTest): AbstractTest {
    this._addChild(child);
    return child;
  }

  public getOrCreateChildSuite(label: string, oldGroups: (Suite | AbstractTest)[]): [Suite, (Suite | AbstractTest)[]] {
    const cond = (v: Suite | AbstractTest): boolean => v.type === 'suite' && v.label === label;
    const found = this.children.find(cond) as Suite | undefined;
    if (found) {
      return [found, oldGroups];
    } else {
      const old = oldGroups.find(cond) as Suite | undefined;
      const newG = new Suite(this._shared, this, label, undefined, old);
      this._addChild(newG);
      return [newG, old ? old.children : []];
    }
  }

  public enumerateDescendants(fn: (v: Suite | AbstractTest) => void): void {
    this.enumerateChildren(child => {
      fn(child);
      if (child instanceof Suite) child.enumerateDescendants(fn);
    });
  }

  public enumerateChildren(fn: (v: Suite | AbstractTest) => void): void {
    for (let i = 0; i < this.children.length; i++) {
      const child = this.children[i];
      fn(child);
    }
  }

  public enumerateTestInfos(fn: (v: AbstractTest) => void): void {
    this.enumerateDescendants(v => {
      if (v instanceof AbstractTest) fn(v);
    });
  }

  public findRouteToTest(pred: (v: AbstractTest) => boolean): [AbstractTest | undefined, Suite[]] {
    const found = Suite.findRouteToTestInArray(this.children, pred);
    if (found[0] !== undefined) found[1].push(this);
    return found;
  }

  public static findRouteToTestInArray(
    array: (Suite | AbstractTest)[],
    pred: (v: AbstractTest) => boolean,
  ): [AbstractTest | undefined, Suite[]] {
    for (let i = 0; i < array.length; ++i) {
      const found = array[i].findRouteToTest(pred);
      if (found[0] !== undefined) return found;
    }
    return [undefined, []];
  }

  public findChildSuite(pred: (v: Suite) => boolean): Suite | undefined {
    return Suite.findChildSuiteInArray(this.children, pred);
  }

  public static findChildSuiteInArray(array: (Suite | AbstractTest)[], pred: (v: Suite) => boolean): Suite | undefined {
    for (let i = 0; i < array.length; i++) {
      if (array[i].type === 'suite' && pred(array[i] as Suite)) return array[i] as Suite;
    }
    return undefined;
  }

  /** If the return value is not empty then we should run the parent */
  public collectTestToRun(tests: ReadonlyArray<string>, isParentIn: boolean): AbstractTest[] {
    const isCurrParentIn = isParentIn || tests.indexOf(this.id) != -1;

    return this.children
      .map(v => v.collectTestToRun(tests, isCurrParentIn))
      .reduce((prev: AbstractTest[], curr: AbstractTest[]) => prev.concat(...curr), []);
  }

  public getTestInfoCount(countSkipped: boolean): number {
    let count = 0;
    this.enumerateTestInfos(v => {
      if (countSkipped || !v.skipped) ++count;
    });
    return count;
  }
}
