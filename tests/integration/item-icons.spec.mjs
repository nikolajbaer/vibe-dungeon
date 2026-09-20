import { assert, installWatchdog, launchGame } from "./harness.mjs";

const stopWatchdog = installWatchdog(45000);
const { browser, page } = await launchGame({ viewport: { width: 900, height: 600 } });

try {
  const result = await page.evaluate(async () => {
    const [{ ITEM_REGISTRY }, { itemIconUrl }] = await Promise.all([
      import("/src/assets/itemRegistry.ts"),
      import("/src/assets/itemIcons.ts"),
    ]);
    const ids = Object.keys(ITEM_REGISTRY);
    return {
      ids,
      rendered: ids.filter(id => itemIconUrl(id)?.startsWith("data:image/png;base64,")),
    };
  });
  assert(result.ids.length > 0, "item registry contains icon candidates");
  assert(result.rendered.length === result.ids.length, `startup rendered all ${result.ids.length} registered item icons`);
} finally {
  await browser.close();
  stopWatchdog();
}
