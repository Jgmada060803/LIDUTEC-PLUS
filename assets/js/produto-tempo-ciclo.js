(function initializeCycleTimeEditor() {
  const panel = document.querySelector("#cycle-time-panel");
  if (!panel) return;
  const productId = new URLSearchParams(window.location.search).get("id");
  if (!productId) return;

  const message = (text, type = "error") => {
    const el = panel.querySelector("#cycle-time-message");
    el.textContent = text;
    el.className = `form-message ${type}`;
    el.hidden = false;
  };

  const fields = () => [...panel.querySelectorAll("input[data-area-codigo]")];

  async function areaIdByCodigo() {
    const codigos = [...new Set(fields().map((input) => input.dataset.areaCodigo))];
    const { data, error } = await window.supabaseClient.from("areas_checklist").select("id,codigo").in("codigo", codigos);
    if (error) throw error;
    return new Map((data || []).map((area) => [area.codigo, area.id]));
  }

  async function loadCycleTimes() {
    const areaIds = await areaIdByCodigo();
    const { data, error } = await window.supabaseClient.from("tempos_ciclo_padrao")
      .select("id,area_id,identificador,tempo_ciclo_segundos")
      .eq("produto_id", productId);
    if (error) throw error;
    const rows = data || [];
    for (const input of fields()) {
      const areaId = areaIds.get(input.dataset.areaCodigo);
      const identificador = input.dataset.identificador || null;
      const existing = rows.find((row) => row.area_id === areaId && (row.identificador || null) === identificador);
      input.value = existing ? Number((3600 / existing.tempo_ciclo_segundos).toFixed(2)) : "";
      input.dataset.rowId = existing ? existing.id : "";
    }
  }

  async function saveCycleTimes(event) {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;
    try {
      const areaIds = await areaIdByCodigo();
      const user = (await window.supabaseClient.auth.getUser()).data.user;
      const operations = fields().map(async (input) => {
        const areaId = areaIds.get(input.dataset.areaCodigo);
        const identificador = input.dataset.identificador || null;
        const rowId = input.dataset.rowId || null;
        const rate = input.value.trim() ? Number(input.value) : null;

        if (rate == null) {
          if (rowId) {
            const { error } = await window.supabaseClient.from("tempos_ciclo_padrao").delete().eq("id", rowId);
            if (error) throw error;
          }
          return;
        }
        if (rate <= 0) throw new Error("A quantidade por hora deve ser maior que zero.");
        const tempoCicloSegundos = 3600 / rate;
        const payload = { produto_id: Number(productId), area_id: areaId, identificador, tempo_ciclo_segundos: tempoCicloSegundos, atualizado_por: user?.id, atualizado_em: new Date().toISOString() };
        const { error } = rowId
          ? await window.supabaseClient.from("tempos_ciclo_padrao").update(payload).eq("id", rowId)
          : await window.supabaseClient.from("tempos_ciclo_padrao").insert(payload);
        if (error) throw error;
      });
      await Promise.all(operations);
      message("Tempos de ciclo salvos com sucesso.", "success");
      await loadCycleTimes();
    } catch (error) {
      message(error.message);
    } finally {
      button.disabled = false;
    }
  }

  panel.querySelector("#cycle-time-form").addEventListener("submit", saveCycleTimes);
  loadCycleTimes().catch((error) => message(error.message));
})();
