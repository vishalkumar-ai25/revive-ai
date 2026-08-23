const fs = require('fs');
let content = fs.readFileSync('src/app/api/recover/[paymentId]/route.ts', 'utf8');

content = content.replace(/    const secret = process\.env\.RECOVERY_LINK_HMAC_SECRET;\n    if \(\!secret\) \{\n      console\.error\("RECOVERY_LINK_HMAC_SECRET is missing from environment"\);\n      return NextResponse\.json\(\{\s*error: "Internal server error"\s*\}, \{ status: 500 \}\);\n    \}\n    const expectedSig = crypto\.createHmac\("sha256", secret\)\.update\(paymentId\)\.digest\("hex"\);\n\n    if \(\!sig \|\| sig !== expectedSig\) \{\n      return NextResponse\.json\(\{\s*error: "Invalid signature"\s*\}, \{ status: 403 \}\);\n    \}/,
`    const secret = process.env.RECOVERY_LINK_HMAC_SECRET;
    if (!secret) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
    }
    const expectedSig = crypto.createHmac("sha256", secret).update(paymentId).digest("hex");

    if (!sig || sig.length !== expectedSig.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
    }`);

fs.writeFileSync('src/app/api/recover/[paymentId]/route.ts', content);
