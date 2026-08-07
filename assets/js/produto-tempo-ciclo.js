(function initializeCycleTimeEditor() {
  const panel = document.querySelector("#cycle-time-panel");
  if (!panel) return;
  const esc = (value = "") => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const productId = new URLSearchParams(window.location.search).get("produto");
  if (!productId) return;

  const unitHintByArea = {
    ACABAMENTO: "Segundos por peça (liberada ou refugada).",
    MOLDAGEM: "Segundos por molde vazado.",
    MACHARIA: "Segundos por sopro. Cadastre um tempo por macho usando o Identificador (M1, M2...).",
    FUSAO: "Segundos por corrida/operação.",
    VAZAMENTO: "Segundos por peça vazada."
  };

  const message = (text, type = "error") => {
    const el = panel.querySelector("#cycle-time-message");
    el.textContent = text;
    el.className = `form-message ${type}`;
    el.hidden = false;
  };

  async function loadAreas() {
    const { data, error } = await window.supabaseClient.from("areas_checklist").select("id,codigo,nome").order("ordem");
    if (error) throw error;
    const areaSelect = panel.querySelector('[name="area_id"]');
    areaSelect.insertAdjacentHTML("beforeend", (data || []).map((a) => `<option value="${a.id}" data-codigo="${esc(a.codigo)}">${esc(a.nome)}</option>`).join(""));
    areaSelect.addEventListener("change", () => {
      const codigo = areaSelect.selectedOptions[0]?.dataset.codigo;
      panel.querySelector("#cycle-time-unit-hint").textContent = unitHintByArea[codigo] || "";
    });
  }

  async function loadCycleTimes() {
    const { data, error } = await window.supabaseClient.from("tempos_ciclo_padrao")
      .select("id,identificador,tempo_ciclo_segundos,areas_checklist(nome)")
      .eq("produto_id", productId)
      .order("area_id");
    if (error) throw error;
    const rows = data || [];
    panel.querySelector("#cycle-time-rows").innerHTML = rows.map((item) => `<tr>
        <td>${esc(item.areas_checklist?.nome || "—")}</td>
        <td>${esc(item.identificador || "—")}</td>
        <td>${Number(item.tempo_ciclo_segundos).toLocaleString("pt-BR")}</td>
        <td><button type="button" class="row-remove" data-cycle-time-id="${item.id}" aria-label="Remover">×</button></td>
      </tr>`).join("");
    panel.querySelector("#cycle-time-empty").hidden = rows.length > 0;
  }

  async function saveCycleTime(event) {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;
    try {
      const form = event.currentTarget;
      const areaId = Number(form.elements.area_id.value);
      const identificador = form.elements.identificador.value.trim() || null;
      const tempoCiclo = Number(form.elements.tempo_ciclo_segundos.value);
      if (!areaId || !tempoCiclo || tempoCiclo <= 0) throw new Error("Preencha setor e tempo de ciclo.");

      let existingQuery = window.supabaseClient.from("tempos_ciclo_padrao").select("id").eq("produto_id", productId).eq("area_id", areaId);
      existingQuery = identificador ? existingQuery.eq("identificador", identificador) : existingQuery.is("identificador", null);
      const { data: existing, error: existingError } = await existingQuery.maybeSingle();
      if (existingError) throw existingError;

      const payload = { produto_id: Number(productId), area_id: areaId, identificador, tempo_ciclo_segundos: tempoCiclo, atualizado_por: (await window.supabaseClient.auth.getUser()).data.user?.id, atualizado_em: new Date().toISOString() };
      const { error } = existing
        ? await window.supabaseClient.from("tempos_ciclo_padrao").update(payload).eq("id", existing.id)
        : await window.supabaseClient.from("tempos_ciclo_padrao").insert(payload);
      if (error) throw error;

      form.reset();
      message("Tempo de ciclo salvo com sucesso.", "success");
      await loadCycleTimes();
    } catch (error) {
      message(error.message);
    } finally {
      button.disabled = false;
    }
  }

  async function deleteCycleTime(id) {
    if (!confirm("Remover este tempo de ciclo?")) return;
    try {
      const { error } = await window.supabaseClient.from("tempos_ciclo_padrao").delete().eq("id", id);
      if (error) throw error;
      await loadCycleTimes();
    } catch (error) {
      message(error.message);
    }
  }

  panel.querySelector("#cycle-time-form").addEventListener("submit", saveCycleTime);
  panel.querySelector("#cycle-time-rows").addEventListener("click", (event) => {
    const button = event.target.closest("[data-cycle-time-id]");
    if (button) deleteCycleTime(button.dataset.cycleTimeId);
  });

  Promise.all([loadAreas(), loadCycleTimes()]).catch((error) => message(error.message));
})();
