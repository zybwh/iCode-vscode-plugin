# /// script
# requires-python = ">=3.11,<3.14"
# dependencies = ["playwright==1.60.0"]
# ///
"""Real Chromium layout tests against the shipped webview bundle; no backend required."""
import subprocess
import sys
import unittest
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[2]
READY = dict(agentName="Code", modelName="Fixture", sessionId="s1", sessionState="running",
             uiLanguage="en", uiTheme="chrys", connectionState="ready", workspacePath="/workspace", planEntries=[])


class WebviewLayout(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(headless=True)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def setUp(self):
        self.context = self.browser.new_context(viewport={"width": 1100, "height": 700}, reduced_motion="reduce")
        self.page = self.context.new_page()
        self.errors = []
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))
        self.page.route("**/*", lambda route: route.abort())
        self.page.set_content('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="app"></div></body></html>')
        self.page.evaluate("""() => {
          window.sent = []; let saved = {};
          window.acquireVsCodeApi = () => ({getState: () => saved, setState: s => saved = s,
            postMessage: m => window.sent.push(m)});
        }""")
        self.page.add_style_tag(path=str(ROOT / "dist/theme.css"))
        self.page.add_script_tag(path=str(ROOT / "dist/webview.js"))
        self.page.wait_for_load_state("networkidle")
        self.host({"type": "setState", "state": READY})
        expect(self.page.locator(".input-field")).to_be_visible()

    def tearDown(self):
        try:
            self.assertEqual(self.errors, [])
        finally:
            self.context.close()

    def host(self, message):
        self.page.evaluate("message => window.dispatchEvent(new MessageEvent('message', {data: message}))", message)

    def append(self, id, kind, text, **extra):
        self.host({"type": "appendMessage", "message": dict(id=id, kind=kind, text=text, timestamp=1000, **extra)})

    def settle(self):
        # Drain paint/observer work, including the production two-frame anchor correction.
        self.page.evaluate("() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))))")

    def populate(self):
        for i in range(12):
            self.append(f"user-{i}", "user", f"Question {i}")
            self.append(f"agent-{i}", "agent", (f"Answer {i}: enough text to produce real layout.\n\n" * 8))
        self.settle()
        self.page.wait_for_function("() => {const a=document.querySelector('.message-area'); return a.scrollHeight>a.clientHeight && a.scrollHeight-a.clientHeight-a.scrollTop<2}")

    def test_user_scroll_survives_stream_and_resize_then_bottom_resumes(self):
        self.populate()
        area = self.page.locator(".message-area")
        area.hover()
        self.page.mouse.wheel(0, -500)
        self.page.wait_for_function("() => {const a=document.querySelector('.message-area'); return a.scrollHeight-a.clientHeight-a.scrollTop>300}")
        self.settle()
        top = area.evaluate("a => a.scrollTop")
        self.host({"type": "updateMessageTextOnly", "messageId": "agent-11", "text": "long streamed output\n\n" * 120})
        self.page.locator(".input-field").fill("new draft\n" * 6)
        self.settle()
        self.assertAlmostEqual(area.evaluate("a => a.scrollTop"), top, delta=3)
        area.evaluate("a => a.scrollTop = a.scrollHeight")
        self.settle()
        self.host({"type": "updateMessageTextOnly", "messageId": "agent-11", "text": "more streamed output\n\n" * 150})
        self.settle()
        self.assertLess(area.evaluate("a => a.scrollHeight-a.clientHeight-a.scrollTop"), 2)

    def test_sidebar_jump_wins_over_queued_bottom_correction(self):
        self.populate()
        # Same JS turn: a growth update queues an anchor correction, then navigation wins.
        self.page.evaluate("""() => {
          window.dispatchEvent(new MessageEvent('message', {data: {type:'appendMessage', message:{id:'tail',kind:'agent',text:'new tail',timestamp:1000}}}));
          document.querySelector('[data-message-id="user-0"]').click();
        }""")
        self.settle()
        self.assertLess(self.page.locator(".message-area").evaluate("a => a.scrollTop"), 100)
        expect(self.page.locator('[data-copy-message-id="user-0"]')).to_be_in_viewport()
        self.host({"type": "updateMessageTextOnly", "messageId": "tail", "text": "continues\n\n" * 50})
        self.settle()
        expect(self.page.locator('[data-copy-message-id="user-0"]')).to_be_in_viewport()

    def test_delayed_restore_preserves_real_caret_and_keyboard_focus(self):
        field = self.page.locator(".input-field")
        field.fill("下一条消息")
        field.evaluate("e => e.setSelectionRange(2, 2)")
        self.host({"type": "setComposer", "text": "old rejected prompt", "restore": True})
        expect(field).to_have_value("下一条消息")
        expect(field).to_be_focused()
        self.assertEqual(field.evaluate("e => e.selectionStart"), 2)
        field.press("X")
        expect(field).to_have_value("下一X条消息")

    def test_narrow_composer_and_drawer_work_in_both_languages(self):
        self.page.set_viewport_size({"width": 390, "height": 740})
        for language in ("en", "zh-CN"):
            self.host({"type": "setState", "state": dict(READY, uiLanguage=language)})
            field = self.page.locator(".input-field")
            field.fill("一个很长的草稿 with a_long_identifier_" * 12)
            expect(field).to_be_in_viewport()
            expect(self.page.locator(".send-btn")).to_be_in_viewport()
            self.assertLessEqual(self.page.evaluate("document.documentElement.scrollWidth"), 390)
            self.page.locator(".sidebar-toggle").click()
            expect(self.page.locator(".sidebar-panel")).to_be_visible()
            self.page.keyboard.press("Escape")
            expect(self.page.locator(".sidebar-panel")).to_be_hidden()
            expect(field).to_have_value("一个很长的草稿 with a_long_identifier_" * 12)


if __name__ == "__main__":
    if "--install" in sys.argv:
        subprocess.run([sys.executable, "-m", "playwright", "install", "chromium",
                        *(["--with-deps"] if "--with-deps" in sys.argv else [])], check=True)
    else:
        unittest.main(verbosity=2)
