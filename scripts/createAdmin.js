const mongoose = require('mongoose');
const readline = require('readline');
const config = require('../src/config/env');
const User = require('../src/models/User');

// Parse command line arguments
const args = process.argv.slice(2);
const useArgs = args.includes('--name') && args.includes('--email') && args.includes('--password');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const question = (query) => {
  return new Promise((resolve) => {
    rl.question(query, resolve);
  });
};

const getArgValue = (flag) => {
  const index = args.indexOf(flag);
  return index !== -1 && args[index + 1] ? args[index + 1] : null;
};

const createAdmin = async () => {
  try {
    console.log('🔧 Connecting to MongoDB...');
    await mongoose.connect(config.mongodb.uri, config.mongodb.options);
    console.log('✅ Connected to MongoDB\n');

    // Check if admin already exists
    const existingAdmin = await User.findOne({ role: 'admin' });
    
    if (existingAdmin) {
      console.log('⚠️  Admin user already exists!');
      console.log(`📧 Email: ${existingAdmin.email}`);
      console.log(`👤 Name: ${existingAdmin.name}`);
      console.log(`🆔 ID: ${existingAdmin._id}\n`);
      
      if (useArgs) {
        console.log('❌ Admin creation cancelled (admin already exists).');
        rl.close();
        await mongoose.connection.close();
        process.exit(1);
      }
      
      const overwrite = await question('Do you want to create another admin? (yes/no): ');
      
      if (overwrite.toLowerCase() !== 'yes' && overwrite.toLowerCase() !== 'y') {
        console.log('❌ Admin creation cancelled.');
        rl.close();
        await mongoose.connection.close();
        process.exit(0);
      }
    }

    console.log('📝 Creating new admin user...\n');

    // Get admin details
    let name, email, password;
    
    if (useArgs) {
      name = getArgValue('--name');
      email = getArgValue('--email');
      password = getArgValue('--password');
      console.log(`Name: ${name}`);
      console.log(`Email: ${email}`);
      console.log(`Password: ${'*'.repeat(password.length)}\n`);
    } else {
      name = await question('Enter admin name: ');
      email = await question('Enter admin email: ');
      password = await question('Enter admin password (min 6 characters): ');
    }

    // Validate input
    if (!name || name.length < 2) {
      throw new Error('Name must be at least 2 characters');
    }

    if (!email || !email.match(/^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/)) {
      throw new Error('Please provide a valid email');
    }

    if (!password || password.length < 6) {
      throw new Error('Password must be at least 6 characters');
    }

    // Check if email already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      throw new Error('Email already registered');
    }

    // Create admin user
    const admin = await User.create({
      name,
      email,
      password,
      role: 'admin',
      isActive: true,
    });

    console.log('\n✅ Admin user created successfully!');
    console.log('═══════════════════════════════════');
    console.log(`👤 Name:  ${admin.name}`);
    console.log(`📧 Email: ${admin.email}`);
    console.log(`🔐 Role:  ${admin.role}`);
    console.log(`🆔 ID:    ${admin._id}`);
    console.log('═══════════════════════════════════\n');
    console.log('🎉 You can now login with these credentials!');

    rl.close();
    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error creating admin:', error.message);
    rl.close();
    await mongoose.connection.close();
    process.exit(1);
  }
};

// Handle process termination
process.on('SIGINT', async () => {
  console.log('\n\n👋 Process interrupted. Closing...');
  rl.close();
  await mongoose.connection.close();
  process.exit(0);
});

// Run the script
console.log('═══════════════════════════════════');
console.log('    COLLABRY ADMIN CREATOR');
console.log('═══════════════════════════════════');

if (useArgs) {
  console.log('    (Using command-line arguments)');
} else {
  console.log('    (Interactive mode)');
  console.log('\n💡 Tip: Use --name, --email, --password flags');
  console.log('   Example: npm run create-admin -- --name "Admin" --email admin@example.com --password pass123\n');
}

console.log('═══════════════════════════════════\n');

createAdmin();
