import { TableModel } from './types'

export class TableHistory {
  private undoStack: TableModel[] = []
  private redoStack: TableModel[] = []
  constructor(
    private current: TableModel,
    private readonly limit = 100
  ) {}

  value() {
    return this.current
  }

  push(next: TableModel) {
    if (next === this.current) return this.current
    this.undoStack.push(this.current)
    if (this.undoStack.length > this.limit) this.undoStack.shift()
    this.redoStack = []
    this.current = next
    return this.current
  }

  undo() {
    const previous = this.undoStack.pop()
    if (!previous) return this.current
    this.redoStack.push(this.current)
    this.current = previous
    return this.current
  }

  redo() {
    const next = this.redoStack.pop()
    if (!next) return this.current
    this.undoStack.push(this.current)
    this.current = next
    return this.current
  }

  serialize() {
    return {
      current: this.current,
      undo: this.undoStack.slice(-20),
      redo: this.redoStack.slice(-20),
    }
  }
}
