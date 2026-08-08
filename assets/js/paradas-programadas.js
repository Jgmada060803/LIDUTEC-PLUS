(function initializeParadasProgramadasHelper(root) {
  // Decide se uma janela de parada programada (refeição, hidratação,
  // manutenção preventiva etc.) se aplica a um contexto (linha OU equipamento,
  // nunca os dois; turno; dia da semana; vigência). Compartilhado entre os
  // módulos de produção (Moldagem, Acabamento e os que vierem depois) para
  // não duplicar a regra de correspondência em cada um.
  function janelaAplicavel(janela, { turno, dataOperacional, linhaId = null, equipamentoCodigo = null }) {
    if (linhaId != null) {
      if (janela.equipamento_codigo != null) return false;
      if (janela.linha_maquina_id != null && janela.linha_maquina_id !== linhaId) return false;
    } else if (equipamentoCodigo != null) {
      if (janela.linha_maquina_id != null) return false;
      if (janela.equipamento_codigo != null && janela.equipamento_codigo !== equipamentoCodigo) return false;
    } else if (janela.linha_maquina_id != null || janela.equipamento_codigo != null) {
      return false;
    }
    if (janela.turno != null && janela.turno !== turno) return false;
    const diaSemana = new Date(`${dataOperacional}T12:00:00`).getDay();
    if (!janela.dias_semana.includes(diaSemana)) return false;
    if (janela.vigencia_inicio > dataOperacional) return false;
    if (janela.vigencia_fim && janela.vigencia_fim < dataOperacional) return false;
    return true;
  }

  function mergeIntervals(intervals) {
    const sorted = intervals.slice().sort((a, b) => a.start - b.start);
    const merged = [];
    for (const interval of sorted) {
      const last = merged[merged.length - 1];
      if (last && interval.start <= last.end) last.end = new Date(Math.max(last.end.getTime(), interval.end.getTime()));
      else merged.push({ start: interval.start, end: interval.end });
    }
    return merged;
  }

  // Devolve os trechos (em Date) de [paradaInicio,paradaFim] que caem dentro
  // de alguma janela aplicável — já mesclados, sem sobreposição entre si.
  function overlapIntervals({ janelas, turnoInicio, paradaInicio, paradaFim, turno, dataOperacional, linhaId = null, equipamentoCodigo = null }) {
    const aplicaveis = (janelas || []).filter((janela) => janelaAplicavel(janela, { turno, dataOperacional, linhaId, equipamentoCodigo }));
    const paradaStart = new Date(paradaInicio).getTime();
    const paradaEnd = new Date(paradaFim).getTime();
    const intervals = [];
    for (const janela of aplicaveis) {
      const { start, end } = root.LIDUTEC_TURNOS.paradaProgramadaJanelaBounds(turnoInicio, janela.horario_inicial, janela.horario_final);
      const overlapStart = Math.max(paradaStart, start.getTime());
      const overlapEnd = Math.min(paradaEnd, end.getTime());
      if (overlapEnd > overlapStart) intervals.push({ start: new Date(overlapStart), end: new Date(overlapEnd) });
    }
    return mergeIntervals(intervals);
  }

  // Devolve os trechos de "base" (um {start,end} em Date) que sobram depois de
  // remover os intervalos de "cuts" — usado para colorir de amarelo só a
  // fração de uma parada real que cai numa janela programada, mantendo o
  // restante com a cor normal de parada.
  function subtractIntervals(base, cuts) {
    let remaining = [{ start: base.start, end: base.end }];
    for (const cut of mergeIntervals(cuts)) {
      const next = [];
      for (const piece of remaining) {
        if (cut.end <= piece.start || cut.start >= piece.end) { next.push(piece); continue; }
        if (cut.start > piece.start) next.push({ start: piece.start, end: cut.start });
        if (cut.end < piece.end) next.push({ start: cut.end, end: piece.end });
      }
      remaining = next;
    }
    return remaining;
  }

  function overlapMinutos(args) {
    const totalMs = overlapIntervals(args).reduce((sum, i) => sum + (i.end.getTime() - i.start.getTime()), 0);
    const paradaMs = new Date(args.paradaFim).getTime() - new Date(args.paradaInicio).getTime();
    return Math.min(Math.round(totalMs / 60000), Math.max(0, Math.round(paradaMs / 60000)));
  }

  const api = { overlapIntervals, overlapMinutos, subtractIntervals };
  if (typeof module === "object" && module.exports) module.exports = api;
  root.LIDUTEC_PARADAS_PROGRAMADAS = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
