const sidebar = document.querySelector("#sidebar");
const menuButton = document.querySelector("#menu-button");
const logoutButton = document.querySelector("#logout-button");

const userName = document.querySelector("#user-name");
const userProfile = document.querySelector("#user-profile");
const userAvatar = document.querySelector("#user-avatar");

const planName = document.querySelector("#plan-name");
const planHeaderDescription =
  document.querySelector("#plan-header-description");

const controlForm = document.querySelector("#control-form");
const parametersContainer =
  document.querySelector("#parameters-container");

const productSelect = document.querySelector("#produto");
const machineSelect = document.querySelector("#maquina");
const ladleSelect = document.querySelector("#panela");

const productGroup = document.querySelector("#product-group");
const machineGroup = document.querySelector("#machine-group");
const ladleGroup = document.querySelector("#ladle-group");

const saveButton = document.querySelector("#save-button");
const formMessage = document.querySelector("#form-message");

let authenticatedUser = null;
let currentPlan = null;
let currentParameters = [];

function getInitials(name = "Usuário") {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function getPlanId() {
  const params = new URLSearchParams(
    window.location.search
  );

  return params.get("plano");
}

function showMessage(message, type = "error") {
  formMessage.textContent = message;
  formMessage.className = `form-message ${type}`;
  formMessage.hidden = false;
}

function clearMessage() {
  formMessage.hidden = true;
  formMessage.textContent = "";
  formMessage.className = "form-message";
}

function setSaving(isSaving) {
  saveButton.disabled = isSaving;
  saveButton.textContent = isSaving
    ? "Salvando..."
    : "Salvar registro";
}

function fillSelect(select, items, labelCallback) {
  const options = items
    .map((item) => {
      return `
        <option value="${item.id}">
          ${labelCallback(item)}
        </option>
      `;
    })
    .join("");

  select.insertAdjacentHTML("beforeend", options);
}

async function loadSupportData() {
  const [
    productsResult,
    machinesResult,
    ladlesResult
  ] = await Promise.all([
    window.supabaseClient
      .from("produtos")
      .select("id, codigo, nome")
      .eq("status", "ATIVO")
      .order("codigo"),

    window.supabaseClient
      .from("maquinas")
      .select("id, codigo, nome")
      .eq("ativo", true)
      .order("codigo"),

    window.supabaseClient
      .from("panelas")
      .select("id, codigo, descricao")
      .eq("ativo", true)
      .order("codigo")
  ]);

  if (productsResult.error) {
    console.error(productsResult.error);
  } else {
    fillSelect(
      productSelect,
      productsResult.data ?? [],
      (item) => `${item.codigo} — ${item.nome}`
    );
  }

  if (machinesResult.error) {
    console.error(machinesResult.error);
  } else {
    fillSelect(
      machineSelect,
      machinesResult.data ?? [],
      (item) => `${item.codigo} — ${item.nome}`
    );
  }

  if (ladlesResult.error) {
    console.error(ladlesResult.error);
  } else {
    fillSelect(
      ladleSelect,
      ladlesResult.data ?? [],
      (item) =>
        item.descricao
          ? `${item.codigo} — ${item.descricao}`
          : item.codigo
    );
  }
}

async function loadPlan(planId) {
  const { data, error } = await window.supabaseClient
    .from("planos_controle")
    .select(`
      id,
      codigo,
      nome,
      descricao,
      area_id,
      produto_obrigatorio,
      maquina_obrigatoria,
      panela_obrigatoria
    `)
    .eq("id", planId)
    .eq("ativo", true)
    .maybeSingle();

  if (error || !data) {
    throw new Error(
      error?.message ??
      "Plano de controle não encontrado."
    );
  }

  currentPlan = data;

  planName.textContent = data.nome;

  planHeaderDescription.textContent =
    data.descricao ?? data.nome;

  productGroup.hidden = false;
  machineGroup.hidden = false;
  ladleGroup.hidden = false;

  productSelect.required = data.produto_obrigatorio;
  machineSelect.required = data.maquina_obrigatoria;
  ladleSelect.required = data.panela_obrigatoria;

  if (data.produto_obrigatorio) {
    productGroup
      .querySelector("label")
      .textContent = "Produto *";
  }

  if (data.maquina_obrigatoria) {
    machineGroup
      .querySelector("label")
      .textContent = "Máquina *";
  }

  if (data.panela_obrigatoria) {
    ladleGroup
      .querySelector("label")
      .textContent = "Panela *";
  }
}

function createParameterInput(parameter) {
  const inputId = `parameter-${parameter.id}`;
  const required = parameter.obrigatorio
    ? "required"
    : "";

  let inputHtml = "";

  if (parameter.tipo_dado === "NUMERO") {
    inputHtml = `
      <input
        type="number"
        step="any"
        id="${inputId}"
        data-parameter-id="${parameter.id}"
        data-type="NUMERO"
        ${required}
      >
    `;
  } else if (parameter.tipo_dado === "BOOLEANO") {
    inputHtml = `
      <select
        id="${inputId}"
        data-parameter-id="${parameter.id}"
        data-type="BOOLEANO"
        ${required}
      >
        <option value="">Selecione</option>
        <option value="true">Sim</option>
        <option value="false">Não</option>
      </select>
    `;
  } else if (
    parameter.tipo_dado === "LISTA" &&
    Array.isArray(parameter.lista_opcoes)
  ) {
    const options = parameter.lista_opcoes
      .map((option) => {
        return `
          <option value="${option}">
            ${option}
          </option>
        `;
      })
      .join("");

    inputHtml = `
      <select
        id="${inputId}"
        data-parameter-id="${parameter.id}"
        data-type="TEXTO"
        ${required}
      >
        <option value="">Selecione</option>
        ${options}
      </select>
    `;
  } else if (parameter.tipo_dado === "DATA") {
    inputHtml = `
      <input
        type="date"
        id="${inputId}"
        data-parameter-id="${parameter.id}"
        data-type="DATA"
        ${required}
      >
    `;
  } else if (parameter.tipo_dado === "HORA") {
    inputHtml = `
      <input
        type="time"
        id="${inputId}"
        data-parameter-id="${parameter.id}"
        data-type="HORA"
        ${required}
      >
    `;
  } else {
    inputHtml = `
      <input
        type="text"
        id="${inputId}"
        data-parameter-id="${parameter.id}"
        data-type="TEXTO"
        ${required}
      >
    `;
  }

  const limits = parameter.permite_limites
    ? `
      <div class="parameter-help">
        Limites padrão:
        ${parameter.valor_minimo_padrao ?? "—"}
        /
        ${parameter.valor_alvo_padrao ?? "—"}
        /
        ${parameter.valor_maximo_padrao ?? "—"}
        ${parameter.unidade ?? ""}
      </div>
    `
    : "";

  return `
    <div class="form-group">

      <label for="${inputId}">
        ${parameter.nome}
        ${parameter.unidade
          ? ` (${parameter.unidade})`
          : ""}
        ${parameter.obrigatorio ? " *" : ""}
      </label>

      ${inputHtml}
      ${limits}

    </div>
  `;
}

async function loadParameters(planId) {
  const { data, error } = await window.supabaseClient
    .from("grupos_controle")
    .select(`
      id,
      nome,
      descricao,
      ordem_exibicao,
      parametros_controle (
        id,
        codigo,
        nome,
        unidade,
        tipo_dado,
        permite_limites,
        valor_minimo_padrao,
        valor_alvo_padrao,
        valor_maximo_padrao,
        lista_opcoes,
        obrigatorio,
        ordem_exibicao,
        ativo
      )
    `)
    .eq("plano_controle_id", planId)
    .eq("ativo", true)
    .order("ordem_exibicao");

  if (error) {
    throw new Error(error.message);
  }

  currentParameters = [];

  parametersContainer.innerHTML = (data ?? [])
    .map((group) => {
      const parameters = (
        group.parametros_controle ?? []
      )
        .filter((parameter) => parameter.ativo)
        .sort(
          (a, b) =>
            a.ordem_exibicao - b.ordem_exibicao
        );

      currentParameters.push(...parameters);

      return `
        <section class="panel parameter-section">

          <div class="panel-header">
            <span class="eyebrow">
              Parâmetros
            </span>

            <h3>${group.nome}</h3>

            ${
              group.descricao
                ? `<p>${group.descricao}</p>`
                : ""
            }
          </div>

          <div class="parameter-grid">
            ${parameters
              .map(createParameterInput)
              .join("")}
          </div>

        </section>
      `;
    })
    .join("");
}

function calculateConformity(
  value,
  minimum,
  maximum
) {
  if (value == null || Number.isNaN(value)) {
    return null;
  }

  if (minimum != null && value < minimum) {
    return false;
  }

  if (maximum != null && value > maximum) {
    return false;
  }

  return true;
}

function collectParameterValues() {
  return currentParameters
    .map((parameter) => {
      const input = document.querySelector(
        `[data-parameter-id="${parameter.id}"]`
      );

      if (!input || input.value === "") {
        return null;
      }

      const base = {
        parametro_controle_id: parameter.id,
        limite_minimo_aplicado:
          parameter.valor_minimo_padrao,
        valor_alvo_aplicado:
          parameter.valor_alvo_padrao,
        limite_maximo_aplicado:
          parameter.valor_maximo_padrao
      };

      if (parameter.tipo_dado === "NUMERO") {
        const value = Number(input.value);

        return {
          ...base,
          valor_numerico: value,
          conforme: calculateConformity(
            value,
            parameter.valor_minimo_padrao,
            parameter.valor_maximo_padrao
          )
        };
      }

      if (parameter.tipo_dado === "BOOLEANO") {
        return {
          ...base,
          valor_booleano: input.value === "true"
        };
      }

      if (parameter.tipo_dado === "DATA") {
        return {
          ...base,
          valor_data: input.value
        };
      }

      if (parameter.tipo_dado === "HORA") {
        return {
          ...base,
          valor_hora: input.value
        };
      }

      return {
        ...base,
        valor_texto: input.value
      };
    })
    .filter(Boolean);
}

async function saveControlRecord(event) {
  event.preventDefault();
  clearMessage();

  if (!controlForm.checkValidity()) {
    controlForm.reportValidity();
    return;
  }

  const values = collectParameterValues();

  const hasNonconformingValue = values.some(
    (item) => item.conforme === false
  );

  try {
    setSaving(true);

    const { data: record, error: recordError } =
      await window.supabaseClient
        .from("registros_controle")
        .insert({
          plano_controle_id: currentPlan.id,
          produto_id:
            productSelect.value || null,
          maquina_id:
            machineSelect.value || null,
          panela_id:
            ladleSelect.value || null,
          area_id:
            currentPlan.area_id || null,
          operador_id:
            authenticatedUser.id,
          corrida:
            document.querySelector("#corrida").value.trim() ||
            null,
          lote:
            document.querySelector("#lote").value.trim() ||
            null,
          ordem_producao:
            document
              .querySelector("#ordem-producao")
              .value.trim() || null,
          turno:
            document.querySelector("#turno").value ||
            null,
          status: hasNonconformingValue
            ? "FORA_ESPECIFICACAO"
            : "CONFORME",
          observacao:
            document
              .querySelector("#observacao")
              .value.trim() || null
        })
        .select("id")
        .single();

    if (recordError) {
      throw recordError;
    }

    if (values.length) {
      const valuesToInsert = values.map((value) => ({
        ...value,
        registro_controle_id: record.id
      }));

      const { error: valuesError } =
        await window.supabaseClient
          .from("valores_controle")
          .insert(valuesToInsert);

      if (valuesError) {
        throw valuesError;
      }
    }

    showMessage(
      hasNonconformingValue
        ? "Registro salvo com alerta de valor fora da especificação."
        : "Registro salvo com sucesso.",
      hasNonconformingValue ? "error" : "success"
    );

    controlForm.reset();

    setTimeout(() => {
      window.location.href =
        `./registros.html?plano=${currentPlan.id}`;
    }, 1200);
  } catch (error) {
    console.error(
      "Erro ao salvar controle de processo:",
      error
    );

    showMessage(
      `Não foi possível salvar: ${error.message}`
    );
  } finally {
    setSaving(false);
  }
}

async function initializePage() {
  const planId = getPlanId();

  if (!planId) {
    window.location.replace("./lista.html");
    return;
  }

  authenticatedUser =
    await window.LIDUTEC_APP.requireAuthenticatedUser();

  if (!authenticatedUser) {
    return;
  }

  const profile =
    await window.LIDUTEC_APP.getCurrentUserProfile(
      authenticatedUser.id
    );

  if (!profile || profile.status !== "ATIVO") {
    return;
  }

  const permissions =
    await window.LIDUTEC_APP.getUserPermissions(
      authenticatedUser.id
    );

  window.LIDUTEC_APP.applyPermissionVisibility(
    permissions
  );

  if (
    !permissions.has(
      "controle_processo.lancar"
    )
  ) {
    alert(
      "Você não possui permissão para realizar lançamentos."
    );

    window.location.replace("./lista.html");
    return;
  }

  userName.textContent = profile.nome;
  userProfile.textContent =
    profile.perfil ?? "Usuário";
  userAvatar.textContent =
    getInitials(profile.nome);

  await Promise.all([
    loadPlan(planId),
    loadSupportData(),
    loadParameters(planId)
  ]);
}

menuButton?.addEventListener("click", () => {
  sidebar?.classList.toggle("open");
});

logoutButton?.addEventListener("click", async () => {
  await window.LIDUTEC_APP.signOut();
});

controlForm.addEventListener(
  "submit",
  saveControlRecord
);

initializePage().catch((error) => {
  console.error("Erro ao abrir lançamento:", error);

  showMessage(
    `Não foi possível abrir o plano: ${error.message}`
  );
});
