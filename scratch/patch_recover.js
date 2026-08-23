const fs = require('fs');
let content = fs.readFileSync('src/app/api/recover/[paymentId]/route.ts', 'utf8');

if (!content.includes("import crypto")) {
  content = 'import crypto from "crypto";\n' + content;
}

content = content.replace(/    const secret = process\.env\.RECOVERY_LINK_HMAC_SECRET;\n    if \(\!secret\) \{\n      return NextResponse\.json\(\{\n        error: "Server configuration error"\n      \}, \{ status: 500 \}\);\n    \}\n\n    const expectedSig = crypto\n      \.createHmac\("sha256", secret\)\n      \.update\(`\$\{paymentId\}\$\{Math\.floor\(Date\.now\(\) \/ 3600000\)\}`\)\n      \.digest\("hex"\);\n\n    if \(\!sig \|\| sig !== expectedSig\) \{\n      return NextResponse\.json\(\{\n        error: "Invalid or expired signature"\n      \}, \{ status: 403 \}\);\n    \}/,
`    const secret = process.env.RECOVERY_LINK_HMAC_SECRET;
    if (!secret) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
    }

    const expectedSig = crypto
      .createHmac("sha256", secret)
      .update(\`\${paymentId}\${Math.floor(Date.now() / 3600000)}\`)
      .digest("hex");

    if (!sig || sig.length !== expectedSig.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
    }`);

fs.writeFileSync('src/app/api/recover/[paymentId]/route.ts', content);
