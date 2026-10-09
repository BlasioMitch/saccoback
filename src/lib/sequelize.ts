import { Sequelize } from 'sequelize';
import pg from 'pg';
import dotenv from 'dotenv';

// Money columns are BIGINT (int8), which pg returns as strings by default.
// Amounts are capped at Number.MAX_SAFE_INTEGER (lib/money.ts), so parsing to a number is exact.
pg.types.setTypeParser(pg.types.builtins.INT8, (value: string) => parseInt(value, 10));

dotenv.config();

const sequelize = new Sequelize(process.env.DATABASE_URL!, {
    logging: false,
    define: {
        schema: 'public'
    }
});

export default sequelize; 