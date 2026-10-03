export async function verifyDebrief({ evaluate, command, delay, capture }) {
  const setViewport = async (width, height) => {
    await command("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    await delay(200);
  };
  const assess = async (label, expectLogScroll) => {
    const state = await evaluate(`(() => {
      const card = document.querySelector('.result-card');
      const log = document.querySelector('.debrief-log');
      const buttons = [...card.querySelectorAll('.debrief-actions button')];
      const cardRect = card.getBoundingClientRect();
      return {
        viewport: [innerWidth, innerHeight],
        cardTop: cardRect.top, cardBottom: cardRect.bottom,
        buttonLabels: buttons.map(button => button.textContent),
        buttonsVisible: buttons.every(button => {
          const rect = button.getBoundingClientRect();
          return rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth;
        }),
        logScroll: log ? log.scrollHeight > log.clientHeight : false,
        logCount: log?.children.length ?? 0,
        radioHidden: !document.querySelector('.radio-feedback'),
      };
    })()`);
    console.log("debrief:", label, state);
    if (!state.buttonsVisible || !state.radioHidden || state.cardTop < 0 || state.cardBottom > state.viewport[1]) {
      throw new Error(`${label}: result card or buttons obscured`);
    }
    if (expectLogScroll && (!state.logScroll || state.logCount !== 60)) throw new Error(`${label}: long event log did not scroll`);
    await capture(`debrief-${label}`);
  };

  await evaluate(`document.querySelector('.game-top button').click()`);
  await delay(150);
  await assess("paused", false);
  await evaluate(`document.querySelector('.debrief-actions button').click()`);
  await delay(150);
  if (await evaluate(`Boolean(document.querySelector('.result-overlay'))`)) throw new Error("Pause did not resume");

  await evaluate(`window.__pitInspect().runtime.eventLog = Array.from({length: 60}, (_, i) => '測試事件 ' + i + '：後援單位已收到並持續執行無線電指令')`);
  await evaluate(`document.querySelector('.radio-trigger').click()`);
  await evaluate(`document.querySelectorAll('.radio-wheel>button')[5].click()`);
  await delay(250);
  await assess("desktop", true);
  const scroll = await evaluate(`(() => {
    const log = document.querySelector('.debrief-log');
    log.scrollTop = log.scrollHeight;
    return log.scrollTop;
  })()`);
  if (scroll < 1) throw new Error("Event log could not be scrolled");

  await setViewport(375, 667);
  await assess("mobile", true);
  await evaluate(`document.querySelector('.debrief-actions button').click()`);
  await delay(200);
  if (await evaluate(`Boolean(document.querySelector('.result-overlay'))`)) throw new Error("Mobile restart did not resume game");
  await evaluate(`window.__pitInspect().runtime.eventLog = Array.from({length: 60}, (_, i) => '再次測試事件 ' + i)`);
  await evaluate(`document.querySelector('.radio-trigger').click()`);
  await evaluate(`document.querySelectorAll('.radio-wheel>button')[5].click()`);
  await delay(200);
  await setViewport(320, 420);
  const tiny = await evaluate(`(() => {
    const card = document.querySelector('.result-card');
    card.scrollTop = card.scrollHeight;
    const buttons = [...card.querySelectorAll('.debrief-actions button')];
    return buttons.every(button => {
      const rect = button.getBoundingClientRect();
      return rect.top >= 0 && rect.bottom <= innerHeight;
    });
  })()`);
  if (!tiny) throw new Error("Tiny viewport buttons were unreachable");
  await capture("debrief-tiny");
  await evaluate(`document.querySelector('.debrief-actions button.secondary').click()`);
  await delay(200);
  if (!await evaluate(`Boolean(document.querySelector('.deploy-button'))`)) throw new Error("Return to settings failed");
}
