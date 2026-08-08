(function initializeSpecsExport() {
  const button = document.querySelector("#export-specs-button");
  if (!button) return;
  const esc = (value = "") => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const headers = ["Produto", "Nome", "Tipo de ficha", "Revisão", "Status", "Vigente", "Grupo", "Parâmetro", "Código", "Unidade", "Crítico", "Valor texto", "Valor numérico", "Valor booleano", "Valor data", "Valor alvo", "Valor mínimo", "Valor máximo", "Não aplicável", "Observação"];

  function rowValues(item) {
    return [
      item.produto_codigo, item.produto_nome, item.ficha_tipo, item.numero_revisao, item.ficha_status,
      item.vigente ? "Sim" : "Não", item.grupo_nome, item.parametro_nome, item.parametro_codigo, item.unidade || "",
      item.critico ? "Sim" : "Não", item.valor_texto || "", item.valor_numerico ?? "",
      item.valor_booleano === null || item.valor_booleano === undefined ? "" : (item.valor_booleano ? "Sim" : "Não"),
      item.valor_data || "", item.valor_alvo ?? "", item.valor_minimo ?? "", item.valor_maximo ?? "",
      item.nao_aplicavel ? "Sim" : "Não", item.valor_observacao || ""
    ].map(String);
  }

  async function exportSpecs() {
    button.disabled = true;
    const originalText = button.textContent;
    button.textContent = "Gerando arquivo...";
    try {
      const { data, error } = await window.supabaseClient.from("export_especificacoes_tecnicas").select("*").order("produto_codigo");
      if (error) throw error;
      const rows = data || [];
      if (!rows.length) {
        alert("Nenhuma especificação encontrada (ou você não tem permissão para exportar).");
        return;
      }
      const tableRows = rows.map((item) => `<tr>${rowValues(item).map((value) => `<td>${esc(value)}</td>`).join("")}</tr>`).join("");
      const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body><table border="1"><thead><tr>${headers.map((value) => `<th>${esc(value)}</th>`).join("")}</tr></thead><tbody>${tableRows}</tbody></table></body></html>`;
      const blob = new Blob([`﻿${html}`], { type: "application/vnd.ms-excel;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `especificacoes-tecnicas-${new Date().toISOString().slice(0, 10)}.xls`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      alert(error.message);
    } finally {
      button.disabled = false;
      button.textContent = originalText;
    }
  }

  button.addEventListener("click", exportSpecs);
})();
