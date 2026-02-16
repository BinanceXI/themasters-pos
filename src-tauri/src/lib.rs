use std::io::Write;
use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;

#[derive(serde::Serialize)]
struct SerialPortDto {
  port_name: String,
  port_type: String,
  manufacturer: Option<String>,
  product: Option<String>,
  serial_number: Option<String>,
  vid: Option<u16>,
  pid: Option<u16>,
}

#[tauri::command]
async fn tcp_print_escpos(host: String, port: u16, data: Vec<u8>) -> Result<(), String> {
  tauri::async_runtime::spawn_blocking(move || {
    let addr = (host.as_str(), port)
      .to_socket_addrs()
      .map_err(|e| format!("Unable to resolve host: {e}"))?
      .next()
      .ok_or("Unable to resolve host")?;

    let timeout = Duration::from_secs(3);
    let mut stream =
      TcpStream::connect_timeout(&addr, timeout).map_err(|e| format!("TCP connect failed: {e}"))?;
    let _ = stream.set_write_timeout(Some(Duration::from_secs(3)));
    let _ = stream.set_nodelay(true);

    stream
      .write_all(&data)
      .map_err(|e| format!("TCP write failed: {e}"))?;
    let _ = stream.flush();

    Ok(())
  })
  .await
  .map_err(|e| format!("Print task failed: {e}"))?
}

#[tauri::command]
async fn serial_list_ports() -> Result<Vec<SerialPortDto>, String> {
  tauri::async_runtime::spawn_blocking(move || {
    let mut ports =
      serialport::available_ports().map_err(|e| format!("Unable to list serial ports: {e}"))?;
    ports.sort_by(|a, b| a.port_name.cmp(&b.port_name));

    let out = ports
      .into_iter()
      .map(|p| {
        let mut dto = SerialPortDto {
          port_name: p.port_name,
          port_type: "unknown".to_string(),
          manufacturer: None,
          product: None,
          serial_number: None,
          vid: None,
          pid: None,
        };

        match p.port_type {
          serialport::SerialPortType::UsbPort(info) => {
            dto.port_type = "usb".to_string();
            dto.manufacturer = info.manufacturer;
            dto.product = info.product;
            dto.serial_number = info.serial_number;
            dto.vid = Some(info.vid);
            dto.pid = Some(info.pid);
          }
          serialport::SerialPortType::BluetoothPort => {
            dto.port_type = "bluetooth".to_string();
          }
          serialport::SerialPortType::PciPort => {
            dto.port_type = "pci".to_string();
          }
          serialport::SerialPortType::Unknown => {}
        }

        dto
      })
      .collect::<Vec<_>>();

    Ok(out)
  })
  .await
  .map_err(|e| format!("List ports task failed: {e}"))?
}

#[tauri::command]
async fn serial_print_escpos(port: String, baud_rate: u32, data: Vec<u8>) -> Result<(), String> {
  tauri::async_runtime::spawn_blocking(move || {
    let port_name = port.clone();
    let mut sp = serialport::new(port, baud_rate)
      .timeout(Duration::from_secs(3))
      .open()
      .map_err(|e| format!("Unable to open serial port {port_name}: {e}"))?;

    // Many BT SPP printers have small buffers; chunking avoids overruns.
    for chunk in data.chunks(512) {
      sp.write_all(chunk)
        .map_err(|e| format!("Serial write failed ({port_name}): {e}"))?;
      std::thread::sleep(Duration::from_millis(20));
    }

    sp.flush()
      .map_err(|e| format!("Serial flush failed ({port_name}): {e}"))?;
    Ok(())
  })
  .await
  .map_err(|e| format!("Print task failed: {e}"))?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![
      tcp_print_escpos,
      serial_list_ports,
      serial_print_escpos
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
