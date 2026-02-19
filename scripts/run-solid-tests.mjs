#!/usr/bin/env node

import { execSync } from "node:child_process";
import fs from "node:fs";

const root = process.cwd();

function read(relPath) {
  return fs.readFileSync(`${root}/${relPath}`, "utf8");
}

function run(cmd) {
  execSync(cmd, { cwd: root, stdio: "pipe", encoding: "utf8" });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const tests = [];
const add = (name, fn) => tests.push({ name, fn });

add("1) backend env guard passes", () => {
  run("node scripts/verify-backend-env.mjs");
});

add("2) typecheck passes", () => {
  run("npx tsc --noEmit");
});

add("3) production build passes", () => {
  run("npm run build");
});

add("4) no Binance identifiers remain in app source", () => {
  const out = execSync(
    "rg -n -i \"binancexi|binance\" src public index.html capacitor.config.ts src-tauri android/app/src/main 2>/dev/null || true",
    {
      cwd: root,
      stdio: "pipe",
      encoding: "utf8",
    }
  ).trim();
  assert(out.length === 0, `Found Binance identifiers:\n${out}`);
});

add("5) thermal print has serial port key", () => {
  const t = read("src/lib/thermalPrint.ts");
  assert(t.includes("PRINTER_SERIAL_PORT_KEY"), "Missing PRINTER_SERIAL_PORT_KEY");
});

add("6) thermal print has serial baud key", () => {
  const t = read("src/lib/thermalPrint.ts");
  assert(t.includes("PRINTER_SERIAL_BAUD_KEY"), "Missing PRINTER_SERIAL_BAUD_KEY");
});

add("7) printer overrides include desktop serial port", () => {
  const t = read("src/lib/thermalPrint.ts");
  assert(t.includes("desktopSerialPort?: string"), "Missing desktopSerialPort override");
});

add("8) printer overrides include Android BT address", () => {
  const t = read("src/lib/thermalPrint.ts");
  assert(t.includes("androidBtAddress?: string"), "Missing androidBtAddress override");
});

add("9) desktop BT mode branch exists in thermal router", () => {
  const t = read("src/lib/thermalPrint.ts");
  assert(t.includes('if (mode === "bt")'), "Missing desktop BT mode branch");
});

add("10) desktop BT sends serial_print_escpos via Tauri", () => {
  const t = read("src/lib/thermalPrint.ts");
  assert(t.includes('invoke("serial_print_escpos"'), "Missing serial_print_escpos invoke path");
});

add("11) Tauri Cargo includes serialport dependency", () => {
  const c = read("src-tauri/Cargo.toml");
  assert(/serialport\s*=/.test(c), "Missing serialport dependency in Cargo.toml");
});

add("12) Tauri backend defines serial_list_ports command", () => {
  const r = read("src-tauri/src/lib.rs");
  assert(/async fn serial_list_ports\(/.test(r), "Missing serial_list_ports command");
});

add("13) Tauri backend defines serial_print_escpos command", () => {
  const r = read("src-tauri/src/lib.rs");
  assert(/async fn serial_print_escpos\(/.test(r), "Missing serial_print_escpos command");
});

add("14) Tauri invoke handler registers serial commands", () => {
  const r = read("src-tauri/src/lib.rs");
  assert(
    r.includes("serial_list_ports") && r.includes("serial_print_escpos"),
    "Missing serial commands in invoke_handler"
  );
});

add("15) Android BT code waits for bluetooth plugin readiness", () => {
  const a = read("src/lib/androidBluetoothPrint.ts");
  assert(a.includes("waitForBluetoothSerial"), "Missing waitForBluetoothSerial guard");
});

add("16) Android BT code checks bluetooth enabled state", () => {
  const a = read("src/lib/androidBluetoothPrint.ts");
  assert(a.includes("btIsEnabled"), "Missing btIsEnabled flow");
});

add("17) Android BT code attempts bluetooth enable", () => {
  const a = read("src/lib/androidBluetoothPrint.ts");
  assert(a.includes("btEnable"), "Missing btEnable flow");
});

add("18) Android BT supports explicit printer address", () => {
  const a = read("src/lib/androidBluetoothPrint.ts");
  assert(a.includes("address?: string"), "Missing explicit address option");
});

add("19) Receipts settings exposes Android+Windows BT UI", () => {
  const p = read("src/pages/ReceiptsPage.tsx");
  assert(
    p.includes("Bluetooth (Android)") &&
      p.includes("Bluetooth (Windows)") &&
      p.includes("COM Port") &&
      p.includes("Baud Rate"),
    "Missing Bluetooth UI controls for Android/Windows"
  );
});

add("20) Android app includes BT permissions + runtime requests", () => {
  const manifest = read("android/app/src/main/AndroidManifest.xml");
  const mainActivity = read("android/app/src/main/java/com/themasters/pos/MainActivity.java");
  assert(
    manifest.includes("android.permission.BLUETOOTH_CONNECT") &&
      manifest.includes("android.permission.BLUETOOTH_SCAN") &&
      mainActivity.includes("Manifest.permission.BLUETOOTH_CONNECT") &&
      mainActivity.includes("Manifest.permission.BLUETOOTH_SCAN"),
    "Missing Bluetooth permissions or runtime permission requests"
  );
});

let passed = 0;
const failures = [];

for (const t of tests) {
  try {
    t.fn();
    passed += 1;
    console.log(`PASS ${t.name}`);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    failures.push({ name: t.name, message });
    console.error(`FAIL ${t.name}`);
    console.error(message);
  }
}

console.log(`\nResult: ${passed}/${tests.length} tests passed.`);

if (failures.length) {
  process.exitCode = 1;
}

