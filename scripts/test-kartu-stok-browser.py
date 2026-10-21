"""Local Chromium acceptance of the real stock-card form with fictional catalog.

Requires npm ci, Python playwright, and /usr/bin/chromium. No application auth,
Supabase client, credentials or external requests are used by this fixture.
"""
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time
from urllib.request import urlopen

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs/evidence/2026-10-21-kartu-stok"
OUT.mkdir(parents=True, exist_ok=True)
form = re.search(r'<form method="get"[\s\S]+?</form>', (ROOT / "src/app/(app)/pos/kartu-stok/page.tsx").read_text()).group()
css = (ROOT / "src/app/globals.css").read_text()
css = re.sub(r'@import "tailwindcss";|@theme inline \{[^}]*\}', '', css)
checks = []
with tempfile.TemporaryDirectory(prefix=".kartu-stok-preview-", dir=ROOT) as tmp:
    preview = Path(tmp)
    (preview / "index.html").write_text('<html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/main.tsx"></script></html>')
    (preview / "style.css").write_text('*{box-sizing:border-box}body{margin:0;padding:20px;background:#f0ede8}h1{font-size:18px}p{font-size:12px;color:#6b6b69}' + css)
    (preview / "main.tsx").write_text('''
import { createRoot } from "react-dom/client";
import { KartuStokItemFilter } from "../src/app/(app)/pos/kartu-stok/KartuStokItemFilter";
import { SubmitButton } from "../src/components/SubmitButton";
import "./style.css";
const items = Array.from({length:1205},(_,i)=>({id:`item-${i}`,code:`SKU-${i}`,name:i>=1203?"Zebra Tuna":`Pakan ${i}`}));
const gudangs = [{id:"wh-1",code:"WH1",name:"Gudang Uji"}];
const sp = new URLSearchParams(location.search);
const itemId = sp.get("item") ?? "", gudangId = sp.get("gudang") ?? "";
const dari = sp.get("dari") ?? "2026-10-01", sampai = sp.get("sampai") ?? "2026-10-20";
createRoot(document.getElementById("root")!).render(<main><h1>Kartu Stok</h1><p>Preview lokal · katalog fiktif 1.205 item</p>''' + form + '</main>);')
    config = json.dumps({"root": tmp, "configFile": False, "resolve": {"alias": {"@": str(ROOT / "src")}}, "server": {"host": "127.0.0.1", "port": 4177, "strictPort": True}, "oxc": {"jsx": {"runtime": "automatic"}}})
    log = open("/tmp/kartu-stok-browser-server.log", "w")
    server = subprocess.Popen(["node", "--input-type=module", "-e", 'import {createServer} from "vite";const server=await createServer(' + config + ');await server.listen();'], cwd=ROOT, stdout=log, stderr=log)
    try:
        for _ in range(60):
            if server.poll() is not None:
                raise RuntimeError(Path(log.name).read_text())
            try:
                urlopen("http://127.0.0.1:4177", timeout=1).close()
                break
            except OSError:
                time.sleep(.2)
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path=os.environ.get("CHROMIUM_PATH", "/usr/bin/chromium"), headless=True, args=["--no-sandbox"])
            for width, label in [(1280, "desktop"), (390, "mobile")]:
                page = browser.new_page(viewport={"width": width, "height": 800})
                errors, external = [], []
                page.on("pageerror", lambda error: errors.append(str(error)))
                def guard(route):
                    if route.request.url.startswith("http://127.0.0.1:4177/"):
                        route.continue_()
                    else:
                        external.append(route.request.url)
                        route.abort()
                page.route("**/*", guard)
                page.goto("http://127.0.0.1:4177/?item=item-1001&gudang=wh-1&dari=2026-10-01&sampai=2026-10-20")
                name = page.get_by_role("combobox", name="Nama Item")
                code = page.get_by_role("textbox", name="Kode Barang")
                name.wait_for()
                assert name.input_value() == "Pakan 1001" and code.input_value() == "SKU-1001"
                name.fill("zEbRa TuNa")
                options = page.locator('[role="option"]')
                expect(options).to_have_count(2)
                assert options.all_text_contents() == ["SKU-1203 · Zebra Tuna", "SKU-1204 · Zebra Tuna"]
                name.press("ArrowDown")
                name.press("ArrowDown")
                page.screenshot(path=str(OUT / f"{label}-search.png"), full_page=True)
                before = page.url
                name.press("Enter")
                assert page.url == before and name.input_value() == "Zebra Tuna" and code.input_value() == "SKU-1204"
                assert page.locator('[name="item"]').input_value() == "item-1204"
                page.get_by_role("button", name="Tampilkan").click()
                page.wait_for_url("**/*item=item-1204*")
                page.wait_for_load_state("networkidle")
                assert name.input_value() == "Zebra Tuna" and code.input_value() == "SKU-1204"
                assert "gudang=wh-1" in page.url and "dari=2026-10-01" in page.url and "sampai=2026-10-20" in page.url
                page.locator('[name="dari"]').fill("2026-09-02")
                page.locator('[name="sampai"]').fill("2026-10-15")
                page.locator('[name="gudang"]').select_option("")
                page.get_by_role("button", name="Tampilkan").click()
                page.wait_for_url("**/*dari=2026-09-02*")
                page.wait_for_load_state("networkidle")
                assert page.locator('[name="dari"]').input_value() == "2026-09-02"
                assert page.locator('[name="sampai"]').input_value() == "2026-10-15"
                assert page.locator('[name="gudang"]').input_value() == ""
                page.go_back()
                page.wait_for_load_state("networkidle")
                assert name.input_value() == "Zebra Tuna" and page.locator('[name="gudang"]').input_value() == "wh-1"
                name.fill("")
                assert code.input_value() == "" and page.locator('[name="item"]').input_value() == ""
                name.fill("SKU-1203")
                page.get_by_role("option", name="SKU-1203 · Zebra Tuna").click()
                assert code.input_value() == "SKU-1203" and name.input_value() == "Zebra Tuna"
                name.fill("not selected")
                name.press("Escape")
                assert name.input_value() == "Zebra Tuna"
                page.screenshot(path=str(OUT / f"{label}-selected.png"), full_page=True)
                assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
                assert errors == [] and external == [], (errors, external)
                checks.append({"viewport": width, "catalogSize": 1205, "passed": ["query restore", "name after 1000", "duplicate codes", "arrow/Enter no submit", "code/name/hidden ID sync", "GET submit", "warehouse/date change", "history back", "clear", "code search and mouse select", "Escape", "no overflow", "no runtime error", "no external request"]})
                page.close()
            browser.close()
    finally:
        server.terminate()
        server.wait(timeout=10)
        log.close()
(OUT / "checks.json").write_text(json.dumps(checks, indent=2) + "\n")
print(json.dumps(checks, indent=2))
