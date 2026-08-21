// =============================================================================
// PRISMA SEED SCRIPT
// =============================================================================
// Initializes sample merchant, customers, and starter data.
// Run with: npm run db:seed
// =============================================================================

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.info("🌱 Seeding database...");

  // 1. Create Demo Merchant
  const merchant = await prisma.merchant.upsert({
    where: { email: "merchant@razorpay-demo.com" },
    update: {},
    create: {
      name: "UrbanKicks India (Direct-to-Consumer)",
      email: "merchant@razorpay-demo.com",
      industry: "E-Commerce & Footwear",
    },
  });

  console.info(`✅ Seeded Merchant: ${merchant.name} (${merchant.id})`);

  // 2. Create Sample Customers
  const sampleCustomers = [
    {
      id: "cust_demo_001",
      email: "rahul.sharma@example.in",
      phone: "+91-9876543210",
      totalPurchases: 4,
      lifetimeValue: 14890,
    },
    {
      id: "cust_demo_002",
      email: "priya.verma@example.in",
      phone: "+91-9812345678",
      totalPurchases: 1,
      lifetimeValue: 2499,
    },
    {
      id: "cust_demo_003",
      email: "ananya.iyer@example.in",
      phone: "+91-9988776655",
      totalPurchases: 7,
      lifetimeValue: 42350,
    },
  ];

  for (const c of sampleCustomers) {
    await prisma.customer.upsert({
      where: { id: c.id },
      update: {},
      create: c,
    });
  }

  console.info(`✅ Seeded ${sampleCustomers.length} sample customers`);
  console.info("🌱 Seeding complete!");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
