const fs = require('fs');
let content = fs.readFileSync('src/app/api/webhooks/payment/route.ts', 'utf8');

content = content.replace(/export async function POST\(req: Request\) \{\n  try \{\n    const json = await req\.json\(\);/,
`export async function POST(req: Request) {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get("X-Razorpay-Signature");
    const secret = process.env.WEBHOOK_SIGNING_SECRET;

    if (!secret || !signature) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
    }

    const expectedSig = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
    if (signature.length !== expectedSig.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
    }

    const json = JSON.parse(rawBody);`);

fs.writeFileSync('src/app/api/webhooks/payment/route.ts', content);
