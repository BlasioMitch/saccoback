// Minimal typing for the only pg API used directly (lib/sequelize.ts), instead of adding @types/pg
declare module 'pg' {
  const pg: {
    types: {
      builtins: { INT8: number };
      setTypeParser(oid: number, parser: (value: string) => unknown): void;
    };
  };
  export default pg;
}
