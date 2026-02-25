import { supabase, parserApiUrl } from "./supabaseClient.js";

const NON_WORK_CODES = ["F", "***", "L", "FE", "LC", "SE"];
const MONTH_NAMES = [
  "JANEIRO", "FEVEREIRO", "MARCO", "ABRIL", "MAIO", "JUNHO",
  "JULHO", "AGOSTO", "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO"
];

const state = {
  session: null,
  profile: null,
  currentSchedule: null,
  currentAssignments: [],
  parsedPayload: null,
  employees: [],
  overwriteContext: null
};

const el = {
  loginBtn: document.getElementById("loginBtn"),
  logoutBtn: document.getElementById("logoutBtn"),
  authInfo: document.getElementById("authInfo"),
  tabs: [...document.querySelectorAll(".main-tabs .tab")],
  tabContents: {
    calendar: document.getElementById("calendarTab"),
    professional: document.getElementById("professionalTab"),
    import: document.getElementById("importTab")
  },
  importTabBtn: document.getElementById("importTabBtn"),

  calendarMonth: document.getElementById("calendarMonth"),
  calendarYear: document.getElementById("calendarYear"),
  calendarSector: document.getElementById("calendarSector"),
  calendarCode: document.getElementById("calendarCode"),
  calendarGrid: document.getElementById("calendarGrid"),

  profMonth: document.getElementById("profMonth"),
  profYear: document.getElementById("profYear"),
  profMonthLabel: document.getElementById("profMonthLabel"),
  prevProfMonth: document.getElementById("prevProfMonth"),
  nextProfMonth: document.getElementById("nextProfMonth"),
  employeeSelect: document.getElementById("employeeSelect"),
  selectedEmployeeTitle: document.getElementById("selectedEmployeeTitle"),
  selectedEmployeeSubtitle: document.getElementById("selectedEmployeeSubtitle"),
  employeeCalendarTitle: document.getElementById("employeeCalendarTitle"),

  profTabs: [...document.querySelectorAll(".prof-tab")],
  mobileProfTabs: [...document.querySelectorAll(".mnav-btn")],
  profContents: {
    calendar: document.getElementById("profCalendarContent"),
    workdays: document.getElementById("profWorkdaysContent"),
    info: document.getElementById("profInfoContent")
  },

  profSummary: document.getElementById("profSummary"),
  nextWorkday: document.getElementById("nextWorkday"),
  profAssignments: document.getElementById("profAssignments"),
  employeeInfoPanel: document.getElementById("employeeInfoPanel"),
  codeStatsPanel: document.getElementById("codeStatsPanel"),
  employeeCalendarGrid: document.getElementById("employeeCalendarGrid"),

  dayModal: document.getElementById("dayModal"),
  dayModalTitle: document.getElementById("dayModalTitle"),
  dayModalBody: document.getElementById("dayModalBody"),
  closeDayModal: document.getElementById("closeDayModal"),

  pdfInput: document.getElementById("pdfInput"),
  parseBtn: document.getElementById("parseBtn"),
  saveBtn: document.getElementById("saveBtn"),
  importStatus: document.getElementById("importStatus"),
  previewBox: document.getElementById("previewBox"),
  overwriteModal: document.getElementById("overwriteModal"),
  confirmOverwrite: document.getElementById("confirmOverwrite"),
  cancelOverwrite: document.getElementById("cancelOverwrite"),
  coworkersModal: document.getElementById("coworkersModal"),
  coworkersModalTitle: document.getElementById("coworkersModalTitle"),
  coworkersModalBody: document.getElementById("coworkersModalBody"),
  closeCoworkersModal: document.getElementById("closeCoworkersModal")
};

init().catch((err) => {
  console.error(err);
  setAuthInfo("Erro ao iniciar aplicação. Verifique o config.js e recarregue a página.");
});

async function init() {
  setupDateSelects();
  bindEvents();

  await loadSession();
  await loadEmployees();
  await refreshCalendarData();
  await renderProfessional();
}

function bindEvents() {
  el.loginBtn.addEventListener("click", async () => {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: getOAuthRedirectUrl() }
    });
  });

  el.logoutBtn.addEventListener("click", async () => {
    await supabase.auth.signOut();
  });

  supabase.auth.onAuthStateChange(async () => {
    await loadSession();
  });

  el.tabs.forEach((tabBtn) => {
    tabBtn.addEventListener("click", () => setActiveTab(tabBtn.dataset.tab));
  });

  el.profTabs.forEach((tabBtn) => {
    tabBtn.addEventListener("click", () => setActiveProfTab(tabBtn.dataset.proftab));
  });
  el.mobileProfTabs.forEach((tabBtn) => {
    tabBtn.addEventListener("click", () => setActiveProfTab(tabBtn.dataset.proftab));
  });

  [el.calendarMonth, el.calendarYear].forEach((node) => {
    node.addEventListener("change", async () => {
      await refreshCalendarData();
      syncProfessionalMonthFromCalendar();
      await renderProfessional();
    });
  });

  [el.calendarSector, el.calendarCode].forEach((node) => node.addEventListener("change", renderCalendar));

  [el.profMonth, el.profYear].forEach((node) => {
    node.addEventListener("change", async () => {
      syncCalendarMonthFromProfessional();
      await refreshCalendarData();
      await renderProfessional();
    });
  });

  el.employeeSelect.addEventListener("change", renderProfessional);

  el.prevProfMonth.addEventListener("click", async () => {
    shiftProfessionalMonth(-1);
    syncCalendarMonthFromProfessional();
    await refreshCalendarData();
    await renderProfessional();
  });

  el.nextProfMonth.addEventListener("click", async () => {
    shiftProfessionalMonth(1);
    syncCalendarMonthFromProfessional();
    await refreshCalendarData();
    await renderProfessional();
  });

  el.closeDayModal.addEventListener("click", () => el.dayModal.classList.add("hidden"));
  el.dayModal.addEventListener("click", (ev) => {
    if (ev.target === el.dayModal) el.dayModal.classList.add("hidden");
  });

  el.parseBtn.addEventListener("click", handleParseFile);
  el.saveBtn.addEventListener("click", handleSaveParsedData);
  el.confirmOverwrite.addEventListener("click", async () => {
    el.overwriteModal.classList.add("hidden");
    if (!state.overwriteContext) return;
    await persistParsedData(state.parsedPayload, { overwrite: true, existingSchedule: state.overwriteContext });
    state.overwriteContext = null;
  });
  el.cancelOverwrite.addEventListener("click", () => {
    state.overwriteContext = null;
    el.overwriteModal.classList.add("hidden");
  });

  el.closeCoworkersModal.addEventListener("click", () => el.coworkersModal.classList.add("hidden"));
  el.coworkersModal.addEventListener("click", (ev) => {
    if (ev.target === el.coworkersModal) el.coworkersModal.classList.add("hidden");
  });
}

function setupDateSelects() {
  const now = new Date();
  const years = [];
  for (let y = now.getFullYear() - 1; y <= now.getFullYear() + 2; y += 1) years.push(y);

  populateSelect(el.calendarMonth, range(1, 12), now.getMonth() + 1);
  populateSelect(el.profMonth, range(1, 12), now.getMonth() + 1);
  populateSelect(el.calendarYear, years, now.getFullYear());
  populateSelect(el.profYear, years, now.getFullYear());

  el.calendarSector.innerHTML = '<option value="ALL">Todos os setores</option>';
  el.calendarCode.innerHTML = '<option value="ALL">Todos os códigos</option>';

  updateProfessionalMonthLabel();
}

function populateSelect(select, options, selectedValue) {
  select.innerHTML = options
    .map((v) => `<option value="${v}" ${String(v) === String(selectedValue) ? "selected" : ""}>${v}</option>`)
    .join("");
}

function range(start, end) {
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

function shiftProfessionalMonth(offset) {
  const month = Number(el.profMonth.value);
  const year = Number(el.profYear.value);
  const d = new Date(year, month - 1 + offset, 1);
  el.profMonth.value = String(d.getMonth() + 1);
  el.profYear.value = String(d.getFullYear());
  updateProfessionalMonthLabel();
}

function updateProfessionalMonthLabel() {
  const month = Number(el.profMonth.value || 1);
  const year = Number(el.profYear.value || new Date().getFullYear());
  el.profMonthLabel.textContent = `${MONTH_NAMES[month - 1]} ${year}`;
}

function syncProfessionalMonthFromCalendar() {
  el.profMonth.value = el.calendarMonth.value;
  el.profYear.value = el.calendarYear.value;
  updateProfessionalMonthLabel();
}

function syncCalendarMonthFromProfessional() {
  el.calendarMonth.value = el.profMonth.value;
  el.calendarYear.value = el.profYear.value;
  updateProfessionalMonthLabel();
}

async function loadSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;

  state.session = data.session;
  state.profile = null;

  if (state.session?.user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("user_id, email, is_admin")
      .eq("user_id", state.session.user.id)
      .maybeSingle();

    state.profile = profile || null;
  }

  updateAuthUi();
}

function updateAuthUi() {
  const isLogged = !!state.session;
  const isAdmin = !!state.profile?.is_admin;

  el.loginBtn.classList.toggle("hidden", isLogged);
  el.logoutBtn.classList.toggle("hidden", !isLogged);
  el.importTabBtn.classList.toggle("hidden", !isAdmin);

  if (!isLogged) {
    setAuthInfo("Você está em modo público. Login Google é necessário apenas para importação.");
  } else if (isAdmin) {
    setAuthInfo(`Logado como ${state.profile?.email}. Acesso admin liberado.`);
  } else {
    setAuthInfo(`Logado como ${state.profile?.email}. Você não é admin.`);
  }

  if (!isAdmin && getActiveTab() === "import") setActiveTab("professional");
}

function setAuthInfo(msg) {
  el.authInfo.textContent = msg;
}

function setActiveTab(tabName) {
  el.tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === tabName));
  Object.entries(el.tabContents).forEach(([name, node]) => {
    node.classList.toggle("active", name === tabName);
  });
}

function getActiveTab() {
  const current = el.tabs.find((tab) => tab.classList.contains("active"));
  return current?.dataset.tab || "professional";
}

function setActiveProfTab(tabName) {
  el.profTabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.proftab === tabName));
  el.mobileProfTabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.proftab === tabName));
  Object.entries(el.profContents).forEach(([name, node]) => {
    node.classList.toggle("active", name === tabName);
  });
}

async function refreshCalendarData() {
  const month = Number(el.calendarMonth.value);
  const year = Number(el.calendarYear.value);

  const { data: schedule, error: scheduleError } = await supabase
    .from("schedules")
    .select("id, month, year, month_name")
    .eq("month", month)
    .eq("year", year)
    .maybeSingle();

  if (scheduleError) throw scheduleError;

  state.currentSchedule = schedule || null;
  state.currentAssignments = [];

  if (schedule?.id) {
    const { data: rows, error } = await supabase
      .from("assignments")
      .select("id, day, sector, role, shift_hours, code, employee_id, employees(name, matricula)")
      .eq("schedule_id", schedule.id)
      .order("day", { ascending: true });

    if (error) throw error;
    state.currentAssignments = rows || [];
  }

  hydrateCalendarFilters();
  renderCalendar();
}

function hydrateCalendarFilters() {
  const sectors = [...new Set(state.currentAssignments.map((x) => x.sector))].sort();
  const codes = [...new Set(state.currentAssignments.map((x) => x.code))].sort();

  const currentSector = el.calendarSector.value || "ALL";
  const currentCode = el.calendarCode.value || "ALL";

  el.calendarSector.innerHTML = ['<option value="ALL">Todos os setores</option>', ...sectors.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`)].join("");
  el.calendarCode.innerHTML = ['<option value="ALL">Todos os códigos</option>', ...codes.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`)].join("");

  if (["ALL", ...sectors].includes(currentSector)) el.calendarSector.value = currentSector;
  if (["ALL", ...codes].includes(currentCode)) el.calendarCode.value = currentCode;
}

function renderCalendar() {
  const month = Number(el.calendarMonth.value);
  const year = Number(el.calendarYear.value);
  const selectedSector = el.calendarSector.value;
  const selectedCode = el.calendarCode.value;

  const daysInMonth = new Date(year, month, 0).getDate();
  const firstWeekday = new Date(year, month - 1, 1).getDay();
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && (today.getMonth() + 1) === month;

  const filtered = state.currentAssignments.filter((row) => {
    const bySector = selectedSector === "ALL" || row.sector === selectedSector;
    const byCode = selectedCode === "ALL" || row.code === selectedCode;
    return bySector && byCode;
  });

  const byDay = new Map();
  filtered.forEach((row) => {
    if (!byDay.has(row.day)) byDay.set(row.day, []);
    byDay.get(row.day).push(row);
  });

  const cells = [];
  for (let i = 0; i < firstWeekday; i += 1) cells.push('<div class="day-cell disabled"></div>');

  for (let day = 1; day <= daysInMonth; day += 1) {
    const count = (byDay.get(day) || []).length;
    const todayClass = isCurrentMonth && day === today.getDate() ? "today" : "";
    cells.push(`
      <div class="day-cell ${todayClass}">
        <div><strong>${day}</strong></div>
        <div class="count">${count} escalado(s)</div>
        <button class="open-day" data-day="${day}">Ver detalhes</button>
      </div>
    `);
  }

  el.calendarGrid.innerHTML = cells.join("");
  [...el.calendarGrid.querySelectorAll(".open-day")].forEach((btn) => {
    btn.addEventListener("click", () => showDayDetails(Number(btn.dataset.day), filtered));
  });
}

function showDayDetails(day, rows) {
  const rowsForDay = rows.filter((r) => r.day === day);
  const grouped = rowsForDay.reduce((acc, row) => {
    if (!acc[row.sector]) acc[row.sector] = [];
    acc[row.sector].push(row);
    return acc;
  }, {});

  const month = Number(el.calendarMonth.value);
  const year = Number(el.calendarYear.value);
  el.dayModalTitle.textContent = `Dia ${day}/${month}/${year}`;

  if (!rowsForDay.length) {
    el.dayModalBody.innerHTML = "Nenhuma pessoa escalada com os filtros atuais.";
    el.dayModal.classList.remove("hidden");
    return;
  }

  el.dayModalBody.innerHTML = Object.entries(grouped)
    .map(([sector, values]) => {
      const people = values
        .map((row) => {
          const name = row.employees?.name || "Sem nome";
          const matricula = row.employees?.matricula || "-";
          return `<div class="list-row"><span>${escapeHtml(name)} (${escapeHtml(matricula)})</span><span>${escapeHtml(row.code)} | ${escapeHtml(row.role || "-")} | ${escapeHtml(row.shift_hours || "-")}</span></div>`;
        })
        .join("");
      return `<section><h4>${escapeHtml(sector)}</h4>${people}</section>`;
    })
    .join("");

  el.dayModal.classList.remove("hidden");
}

async function loadEmployees() {
  const { data, error } = await supabase
    .from("employees")
    .select("id, matricula, name")
    .order("name", { ascending: true });

  if (error) throw error;

  state.employees = data || [];

  const current = el.employeeSelect.value;
  el.employeeSelect.innerHTML = [
    '<option value="">Selecione um profissional...</option>',
    ...state.employees.map((emp) => `<option value="${emp.id}">${escapeHtml(emp.name)} (${escapeHtml(emp.matricula)})</option>`)
  ].join("");

  if (current && state.employees.some((e) => e.id === current)) {
    el.employeeSelect.value = current;
  }
}

function findSelectedEmployee() {
  const id = el.employeeSelect.value;
  if (!id) return null;
  return state.employees.find((e) => e.id === id) || null;
}

async function renderProfessional() {
  updateProfessionalMonthLabel();

  const month = Number(el.profMonth.value);
  const year = Number(el.profYear.value);
  const employee = findSelectedEmployee();

  el.profSummary.innerHTML = "Selecione um profissional.";
  el.profAssignments.innerHTML = "";
  el.nextWorkday.textContent = "";
  el.employeeInfoPanel.textContent = "Selecione um profissional.";
  el.codeStatsPanel.textContent = "";
  el.employeeCalendarGrid.innerHTML = "";

  if (!employee) {
    el.selectedEmployeeTitle.textContent = "Escala de Fisioterapia";
    el.selectedEmployeeSubtitle.textContent = "Selecione um profissional para ver os detalhes.";
    el.employeeCalendarTitle.textContent = "Calendário do Profissional";
    return;
  }

  el.selectedEmployeeTitle.textContent = employee.name;
  el.selectedEmployeeSubtitle.textContent = `Escala de Trabalho - ${MONTH_NAMES[month - 1]} ${year}`;
  el.employeeCalendarTitle.textContent = `Calendário de ${MONTH_NAMES[month - 1]} ${year}`;

  const { data: schedule } = await supabase
    .from("schedules")
    .select("id")
    .eq("month", month)
    .eq("year", year)
    .maybeSingle();

  if (!schedule?.id) {
    el.profSummary.innerHTML = "Sem escala para mês/ano selecionado.";
    return;
  }

  const { data: rows, error } = await supabase
    .from("assignments")
    .select("id, day, sector, code, role, shift_hours")
    .eq("schedule_id", schedule.id)
    .eq("employee_id", employee.id)
    .order("day", { ascending: true });

  if (error) throw error;

  if (!rows?.length) {
    el.profSummary.innerHTML = "Profissional sem lançamentos nesse mês.";
    return;
  }

  const countByCode = rows.reduce((acc, row) => {
    acc[row.code] = (acc[row.code] || 0) + 1;
    return acc;
  }, {});

  const workDays = rows.filter((r) => !NON_WORK_CODES.includes(r.code)).length;
  const offDays = rows.length - workDays;

  el.profSummary.innerHTML = [
    `<div class="list-row"><span>Dias de trabalho</span><strong>${workDays}</strong></div>`,
    `<div class="list-row"><span>Dias de folga</span><strong>${offDays}</strong></div>`,
    `<div class="list-row"><span>Total de registros</span><strong>${rows.length}</strong></div>`
  ].join("");

  const today = new Date();
  const currentDay = (today.getFullYear() === year && today.getMonth() + 1 === month) ? today.getDate() : 1;
  const next = rows.find((r) => !NON_WORK_CODES.includes(r.code) && r.day >= currentDay)
    || rows.find((r) => !NON_WORK_CODES.includes(r.code));

  el.nextWorkday.textContent = next
    ? `Próximo dia de trabalho: ${next.day}/${month}/${year} (${next.code})`
    : "Sem próximo dia de trabalho no mês selecionado.";

  el.profAssignments.innerHTML = rows
    .map((r) => {
      const status = NON_WORK_CODES.includes(r.code) ? "FOLGA" : "TRABALHA";
      return `
        <div class="list-row">
          <span>${r.day}/${month}/${year} | ${escapeHtml(r.sector)} | ${escapeHtml(r.code)} | ${status}</span>
          <button class="show-coworkers" data-day="${r.day}" data-sector="${escapeHtml(r.sector)}" data-employee="${employee.id}" data-schedule="${schedule.id}">Com quem trabalha</button>
        </div>
      `;
    })
    .join("");

  [...el.profAssignments.querySelectorAll(".show-coworkers")].forEach((btn) => {
    btn.addEventListener("click", async () => {
      await showCoworkers({
        day: Number(btn.dataset.day),
        sector: btn.dataset.sector,
        employeeId: btn.dataset.employee,
        scheduleId: btn.dataset.schedule
      });
    });
  });

  el.employeeInfoPanel.innerHTML = [
    `<div class="list-row"><span>Nome</span><strong>${escapeHtml(employee.name)}</strong></div>`,
    `<div class="list-row"><span>Matrícula</span><strong>${escapeHtml(employee.matricula)}</strong></div>`,
    `<div class="list-row"><span>Função</span><strong>${escapeHtml(rows[0]?.role || "-")}</strong></div>`,
    `<div class="list-row"><span>Horário</span><strong>${escapeHtml(rows[0]?.shift_hours || "-")}</strong></div>`
  ].join("");

  el.codeStatsPanel.innerHTML = Object.entries(countByCode)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([code, count]) => `<div class="list-row"><span>${escapeHtml(code)}</span><strong>${count}</strong></div>`)
    .join("");

  renderEmployeeCalendar(rows, month, year);
}

function renderEmployeeCalendar(rows, month, year) {
  const daysInMonth = new Date(year, month, 0).getDate();
  const firstWeekday = new Date(year, month - 1, 1).getDay();
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && (today.getMonth() + 1) === month;

  const byDay = new Map(rows.map((r) => [r.day, r]));
  const cells = [];
  for (let i = 0; i < firstWeekday; i += 1) cells.push('<div class="day-cell disabled"></div>');

  for (let day = 1; day <= daysInMonth; day += 1) {
    const row = byDay.get(day);
    const code = row?.code || "-";
    const status = row ? (NON_WORK_CODES.includes(row.code) ? "Folga" : "Trabalho") : "Sem registro";
    const todayClass = isCurrentMonth && day === today.getDate() ? "today" : "";
    cells.push(`
      <div class="day-cell ${todayClass}">
        <div><strong>${day}</strong></div>
        <div class="count">${escapeHtml(code)} | ${escapeHtml(status)}</div>
      </div>
    `);
  }

  el.employeeCalendarGrid.innerHTML = cells.join("");
}

async function showCoworkers({ day, sector, employeeId, scheduleId }) {
  const { data, error } = await supabase
    .from("assignments")
    .select("employee_id, code, employees(name, matricula)")
    .eq("schedule_id", scheduleId)
    .eq("sector", sector)
    .eq("day", day)
    .neq("employee_id", employeeId);

  if (error) throw error;

  const month = Number(el.profMonth.value);
  const year = Number(el.profYear.value);
  el.coworkersModalTitle.textContent = `Companheiros em ${day}/${month}/${year} - ${sector}`;

  if (!data?.length) {
    el.coworkersModalBody.textContent = "Nenhum colega encontrado para esse dia/setor.";
    el.coworkersModal.classList.remove("hidden");
    return;
  }

  el.coworkersModalBody.innerHTML = data
    .map((row) => `<div class="list-row"><span>${escapeHtml(row.employees?.name || "-")} (${escapeHtml(row.employees?.matricula || "-")})</span><span>${escapeHtml(row.code)}</span></div>`)
    .join("");
  el.coworkersModal.classList.remove("hidden");
}

async function handleParseFile() {
  if (!state.profile?.is_admin) return setImportStatus("Apenas admin pode importar.", true);

  const file = el.pdfInput.files?.[0];
  if (!file) return setImportStatus("Selecione um arquivo PDF/CSV antes de processar.", true);

  const parserUrl = getEffectiveParserUrl();
  if (!parserUrl) return setImportStatus("PARSER_API_URL não configurado em config.js.", true);

  setImportStatus("Processando arquivo...");

  const body = new FormData();
  body.append("file", file);

  try {
    const response = await fetch(parserUrl, { method: "POST", body });
    if (!response.ok) {
      const message = await response.text();
      throw new Error(message || "Falha no parser.");
    }

    const json = await response.json();
    validateParsedPayload(json);

    const parsedAssignments = countParsedAssignments(json);
    if (!parsedAssignments) throw new Error("Arquivo processado sem lançamentos de dias.");

    state.parsedPayload = json;
    el.previewBox.textContent = JSON.stringify(json, null, 2);
    el.saveBtn.disabled = false;
    setImportStatus(`Arquivo processado com ${parsedAssignments} lançamento(s). Revise o preview e clique em salvar.`);
  } catch (error) {
    console.error(error);
    state.parsedPayload = null;
    el.saveBtn.disabled = true;
    setImportStatus(`Erro no parse: ${error.message}`, true);
  }
}

function getEffectiveParserUrl() {
  const raw = (parserApiUrl || "").trim();
  if (!raw) return "";
  return raw.replace(/\/parse-ai\/?$/i, "/parse");
}

function validateParsedPayload(payload) {
  if (!payload?.metadata?.month || !payload?.metadata?.year || !Array.isArray(payload?.sectors)) {
    throw new Error("JSON inválido: metadata e sectors são obrigatórios.");
  }
}

async function handleSaveParsedData() {
  if (!state.parsedPayload) return setImportStatus("Nenhum parse disponível.", true);

  if (!countParsedAssignments(state.parsedPayload)) {
    return setImportStatus("Não há lançamentos para salvar. Revise o arquivo importado.", true);
  }

  const { month, year } = state.parsedPayload.metadata;
  const { data: existing } = await supabase
    .from("schedules")
    .select("id, month, year")
    .eq("month", month)
    .eq("year", year)
    .maybeSingle();

  if (existing) {
    state.overwriteContext = existing;
    el.overwriteModal.classList.remove("hidden");
    return;
  }

  await persistParsedData(state.parsedPayload, { overwrite: false, existingSchedule: null });
}

async function persistParsedData(payload, { overwrite, existingSchedule }) {
  if (!state.profile?.is_admin) return setImportStatus("Apenas admin pode salvar.", true);

  const { metadata, sectors, legend } = payload;
  setImportStatus("Salvando no banco...");

  try {
    let scheduleId;

    if (existingSchedule && overwrite) {
      scheduleId = existingSchedule.id;
      const { error: delError } = await supabase.from("assignments").delete().eq("schedule_id", scheduleId);
      if (delError) throw delError;

      const { error: updError } = await supabase
        .from("schedules")
        .update({ month_name: metadata.month_name || null, source_filename: metadata.source_filename || null })
        .eq("id", scheduleId);
      if (updError) throw updError;
    } else {
      const { data: insertedSchedule, error: scheduleError } = await supabase
        .from("schedules")
        .insert({
          month: metadata.month,
          year: metadata.year,
          month_name: metadata.month_name || null,
          source_filename: metadata.source_filename || null
        })
        .select("id")
        .single();

      if (scheduleError) throw scheduleError;
      scheduleId = insertedSchedule.id;
    }

    const employeeRows = [];
    sectors.forEach((sector) => {
      (sector.employees || []).forEach((emp) => {
        employeeRows.push({ matricula: String(emp.matricula).trim(), name: String(emp.name).trim() });
      });
    });

    const uniqueEmployees = Object.values(employeeRows.reduce((acc, e) => {
      acc[e.matricula] = e;
      return acc;
    }, {}));

    if (uniqueEmployees.length) {
      const { error: upsertError } = await supabase.from("employees").upsert(uniqueEmployees, { onConflict: "matricula" });
      if (upsertError) throw upsertError;
    }

    const { data: allEmployees, error: allEmployeesError } = await supabase.from("employees").select("id, matricula");
    if (allEmployeesError) throw allEmployeesError;
    const employeeByMatricula = new Map((allEmployees || []).map((e) => [e.matricula, e.id]));

    const assignmentRows = [];
    sectors.forEach((sector) => {
      (sector.employees || []).forEach((emp) => {
        const employeeId = employeeByMatricula.get(String(emp.matricula).trim());
        if (!employeeId) return;

        Object.entries(emp.days || {}).forEach(([day, code]) => {
          assignmentRows.push({
            schedule_id: scheduleId,
            employee_id: employeeId,
            sector: sector.name,
            role: emp.role || null,
            shift_hours: emp.shift_hours || null,
            day: Number(day),
            code: String(code).trim()
          });
        });
      });
    });

    if (assignmentRows.length) {
      const { error: assignmentError } = await supabase
        .from("assignments")
        .upsert(assignmentRows, { onConflict: "schedule_id,employee_id,sector,day" });
      if (assignmentError) throw assignmentError;
    }

    if (legend && typeof legend === "object") {
      const legendRows = Object.entries(legend).map(([code, description]) => ({ code, description }));
      if (legendRows.length) {
        const { error: legendError } = await supabase.from("code_legend").upsert(legendRows, { onConflict: "code" });
        if (legendError) throw legendError;
      }
    }

    const importedMonth = String(metadata.month);
    const importedYear = String(metadata.year);
    el.calendarMonth.value = importedMonth;
    el.calendarYear.value = importedYear;
    el.profMonth.value = importedMonth;
    el.profYear.value = importedYear;
    updateProfessionalMonthLabel();

    setImportStatus(
      overwrite
        ? `Escala sobrescrita com sucesso. ${assignmentRows.length} lançamento(s) gravado(s).`
        : `Escala salva com sucesso. ${assignmentRows.length} lançamento(s) gravado(s).`
    );

    await loadEmployees();
    await refreshCalendarData();
    await renderProfessional();
  } catch (error) {
    console.error(error);
    setImportStatus(`Erro ao salvar: ${error.message}`, true);
  }
}

function countParsedAssignments(payload) {
  return (payload?.sectors || []).reduce((accS, sector) => {
    return accS + (sector.employees || []).reduce((accE, emp) => accE + Object.keys(emp.days || {}).length, 0);
  }, 0);
}

function setImportStatus(message, isError = false) {
  el.importStatus.textContent = message;
  el.importStatus.style.color = isError ? "#af2f2f" : "";
  if (isError) window.alert(message);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getOAuthRedirectUrl() {
  const configuredBase = window.APP_CONFIG?.APP_BASE_URL?.trim();
  if (configuredBase) return configuredBase;
  return `${window.location.origin}${window.location.pathname}`;
}
