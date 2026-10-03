// A customizable native select opens in the top layer, inside its owning dialog.
// Let the browser dismiss that picker before Escape reaches the outer dialog.
export function isSelectPickerEvent(event: KeyboardEvent): boolean {
  const target = event.target;
  if (!(target instanceof Element)) return false;
  const select = target.closest("select");
  return Boolean(
    target.closest("option") ||
      (select && CSS.supports("selector(select:open)") && select.matches(":open")),
  );
}
