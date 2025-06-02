// seed.js
import { models } from './models/index.js';
import bcrypt from 'bcryptjs';
import { UserRole, UserStatus, Gender } from './models/user.js';
export const seedDatabase = async () => {
    try {
        console.log('Checking for existing admin user...');
        const existingAdmin = await models.User.findOne({
            where: { email: 'admin@example.com' },
        });
        if (existingAdmin) {
            console.log('Admin user already exists. Skipping seeding.');
            return;
        }
        console.log('Seeding admin and default user...');
        const adminPassword = await bcrypt.hash('admin123', 10);
        const userPassword = await bcrypt.hash('user123', 10);
        await models.User.bulkCreate([
            {
                first_name: 'John',
                last_name: 'Doe',
                other_name: 'Admin',
                email: 'admin@example.com',
                password: adminPassword,
                role: UserRole.ADMIN,
                status: UserStatus.ACTIVE,
                contact: '1234567890',
                gender: Gender.MALE,
                dob: new Date('1990-01-01'),
                joinDate: new Date(),
            },
            {
                first_name: 'Jane',
                last_name: 'Smith',
                email: 'user@example.com',
                password: userPassword,
                role: UserRole.USER,
                status: UserStatus.ACTIVE,
                contact: '0987654321',
                gender: Gender.FEMALE,
                dob: new Date('1995-05-05'),
                joinDate: new Date(),
            },
        ]);
        console.log('Seeding completed successfully!');
    }
    catch (error) {
        console.error('Error during seeding:', error);
        throw error;
    }
};
