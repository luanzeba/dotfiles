use base64::{
    engine::general_purpose::{URL_SAFE, URL_SAFE_NO_PAD},
    Engine as _,
};
use serde_json::{json, Value};
use std::{
    env,
    io::{self, IsTerminal},
    process,
};

const USAGE: &str = "Usage: jwt-decode

Paste a JWT at the hidden prompt, or pipe it on stdin.
Command-line token arguments are intentionally unsupported.";

fn decode_part(part: &str) -> Result<Value, ()> {
    let bytes = URL_SAFE_NO_PAD
        .decode(part)
        .or_else(|_| URL_SAFE.decode(part))
        .map_err(|_| ())?;
    serde_json::from_slice(&bytes).map_err(|_| ())
}

fn jwt_value(token: &str) -> &str {
    let token = token.trim();
    match token.split_once(' ') {
        Some((scheme, value)) if scheme.eq_ignore_ascii_case("bearer") => value.trim(),
        _ => token,
    }
}

fn decode(token: &str) -> Result<Value, ()> {
    let mut parts = jwt_value(token).split('.');
    let (Some(header), Some(payload), Some(_signature), None) =
        (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return Err(());
    };

    let header = decode_part(header)?;
    let payload = decode_part(payload)?;
    if !header.is_object() || !payload.is_object() {
        return Err(());
    }
    Ok(json!({ "header": header, "payload": payload }))
}

fn read_token() -> io::Result<String> {
    if io::stdin().is_terminal() {
        rpassword::prompt_password("JWT: ")
    } else {
        let mut token = String::new();
        io::stdin().read_line(&mut token)?;
        Ok(token)
    }
}

fn fail(message: &str) -> ! {
    eprintln!("{message}");
    process::exit(1);
}

fn main() {
    let args: Vec<_> = env::args().skip(1).collect();
    if args.len() == 1 && args[0] == "--self-test" {
        let token = "Bearer eyJhbGciOiJub25lIn0.eyJzdWIiOiIxMjMifQ.";
        assert_eq!(
            decode(token).unwrap(),
            json!({ "header": { "alg": "none" }, "payload": { "sub": "123" } })
        );
        assert_eq!(jwt_value(token).len(), 39);
        println!("ok");
        return;
    }
    if !args.is_empty() {
        let help = args.len() == 1 && matches!(args[0].as_str(), "-h" | "--help");
        println!("{USAGE}");
        process::exit(if help { 0 } else { 2 });
    }

    let token = read_token().unwrap_or_else(|_| fail("Could not read JWT"));
    let decoded = decode(&token).unwrap_or_else(|_| fail("Invalid JWT"));
    eprintln!("Warning: signature not verified.");
    println!("{}", serde_json::to_string_pretty(&decoded).unwrap());
    eprintln!("JWT size: {} bytes", jwt_value(&token).len());
}
