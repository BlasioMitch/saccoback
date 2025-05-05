import { Sequelize } from 'sequelize';
import dotenv from 'dotenv';

dotenv.config();

const sequelize = new Sequelize(process.env.DATABASE_URL!, {
    logging: false,
    define: {
        schema: 'public'
    }
});

export default sequelize; 