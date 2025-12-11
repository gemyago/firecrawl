use hmac::{Hmac, Mac};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

pub fn sign_payload(
    secret: &str,
    payload_json: &str,
) -> Result<String, hmac::digest::InvalidLength> {
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes())?;
    mac.update(payload_json.as_bytes());
    let result = mac.finalize();
    Ok(format!("sha256={}", hex::encode(result.into_bytes())))
}
