export interface IndexDef {
  name: string;
  columns: string[];
  unique?: boolean;
}

export interface TableDef {
  name: string;
  columns: ColumnDef[];
  indexes?: IndexDef[];
}

export interface ColumnDef {
  name: string;
  type: string;
  length?: number;
  nullable?: boolean;
  default?: any;
}

export interface DiffResult {
  createTables: TableDef[];
  dropTables: string[];
  addColumns: { table: string; column: ColumnDef }[];
  dropColumns: { table: string; column: string }[];
  modifyColumns: { table: string; column: ColumnDef }[];
  addIndexes: { table: string; index: IndexDef }[];
  dropIndexes: { table: string; index: string }[];
}

export class DiffEngine {
  compute(desired: TableDef[], current: TableDef[]): DiffResult {
    const result: DiffResult = {
      createTables: [],
      dropTables: [],
      addColumns: [],
      dropColumns: [],
      modifyColumns: [],
      addIndexes: [],
      dropIndexes: [],
    };

    const currentMap = new Map(current.map(t => [t.name, t]));
    const desiredMap = new Map(desired.map(t => [t.name, t]));

    // Find tables to create
    for (const [name, table] of desiredMap) {
      if (!currentMap.has(name)) {
        result.createTables.push(table);
      }
    }

    // Find tables to drop
    for (const [name] of currentMap) {
      if (!desiredMap.has(name)) {
        result.dropTables.push(name);
      }
    }

    // Compare columns and indexes in existing tables
    for (const [name, desiredTable] of desiredMap) {
      const currentTable = currentMap.get(name);
      if (!currentTable) continue;

      const currentColMap = new Map(currentTable.columns.map(c => [c.name, c]));
      const desiredColMap = new Map(desiredTable.columns.map(c => [c.name, c]));

      // Find columns to add
      for (const [colName, col] of desiredColMap) {
        if (!currentColMap.has(colName)) {
          result.addColumns.push({ table: name, column: col });
        }
      }

      // Find columns to drop
      for (const [colName] of currentColMap) {
        if (!desiredColMap.has(colName)) {
          result.dropColumns.push({ table: name, column: colName });
        }
      }

      // Find columns to modify
      for (const [colName, desiredCol] of desiredColMap) {
        const currentCol = currentColMap.get(colName);
        if (currentCol && this.columnChanged(currentCol, desiredCol)) {
          result.modifyColumns.push({ table: name, column: desiredCol });
        }
      }

      // Compare indexes
      const currentIndexMap = new Map((currentTable.indexes || []).map(i => [i.name, i]));
      const desiredIndexMap = new Map((desiredTable.indexes || []).map(i => [i.name, i]));

      // Find indexes to add
      for (const [idxName, idx] of desiredIndexMap) {
        if (!currentIndexMap.has(idxName)) {
          result.addIndexes.push({ table: name, index: idx });
        } else if (this.indexChanged(currentIndexMap.get(idxName)!, idx)) {
          // Index exists but changed — drop old + add new
          result.dropIndexes.push({ table: name, index: idxName });
          result.addIndexes.push({ table: name, index: idx });
        }
      }

      // Find indexes to drop
      for (const [idxName] of currentIndexMap) {
        if (!desiredIndexMap.has(idxName)) {
          result.dropIndexes.push({ table: name, index: idxName });
        }
      }
    }

    return result;
  }

  private columnChanged(current: ColumnDef, desired: ColumnDef): boolean {
    return current.type !== desired.type ||
           current.length !== desired.length ||
           current.nullable !== desired.nullable;
  }

  private indexChanged(current: IndexDef, desired: IndexDef): boolean {
    if (current.unique !== desired.unique) return true;
    if (current.columns.length !== desired.columns.length) return true;
    for (let i = 0; i < current.columns.length; i++) {
      if (current.columns[i] !== desired.columns[i]) return true;
    }
    return false;
  }

  isEmpty(diff: DiffResult): boolean {
    return diff.createTables.length === 0 &&
           diff.dropTables.length === 0 &&
           diff.addColumns.length === 0 &&
           diff.dropColumns.length === 0 &&
           diff.modifyColumns.length === 0 &&
           diff.addIndexes.length === 0 &&
           diff.dropIndexes.length === 0;
  }
}
