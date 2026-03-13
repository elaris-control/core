const fs = require("fs");
const crypto = require("crypto");

// verifies obj.signature over JSON(obj without signature) using public key
function verifySignature(obj, pubkeyPath) {
  try {
    const pub = fs.readFileSync(pubkeyPath, "utf8");
    const signatureB64 = obj.signature;

    const cloned = { ...obj };
    delete cloned.signature;

    const payload = JSON.stringify(cloned);
    const verify = crypto.createVerify("RSA-SHA256");
    verify.update(payload);
    verify.end();

    return verify.verify(pub, Buffer.from(signatureB64, "base64"));
  } catch (_) {
    return false;
  }
}

module.exports = { verifySignature };
