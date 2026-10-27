const form = document.getElementById("taskForm");
const taskList = document.getElementById("taskList");
const planDate = document.getElementById("planDate");
const notificationButton = document.getElementById("notificationButton");
const notificationStatus = document.getElementById("notificationStatus");
const reminderToast = document.getElementById("reminderToast");
const reminderMessage = document.getElementById("reminderMessage");
const feedback = document.getElementById("taskFeedback");
const submitButton = document.getElementById("submitTaskButton");
const cancelEditButton = document.getElementById("cancelEditButton");
const customCategoryField = document.getElementById("customCategoryField");
const repeatIntervalField = document.getElementById("repeatIntervalField");
const categoryFilter = document.getElementById("taskCategoryFilter");
const sortControl = document.getElementById("taskSort");
const soundToggle = document.getElementById("soundToggle");
const testReminderSoundButton = document.getElementById("testReminderSound");
const overdueRepeat = document.getElementById("overdueRepeat");

const STORAGE_KEY = "myDailyPlanner.tasks";
const THEME_KEY = "myDailyPlanner.theme";
const REMINDER_SETTINGS_KEY = "myDailyPlanner.reminderSettings";
const REMINDER_LEAD_TIME = 15 * 60 * 1000;
const DEFAULT_REMINDER_TIME = "21:00";
const VALID_PRIORITIES = ["high", "normal", "low"];
const VALID_REPEATS = ["none", "daily", "weekly", "custom"];

let tasks = [];
let hasLegacyDescriptions = false;
let reminderSettings = { soundEnabled: true, notificationsEnabled: false, repeatMinutes: 60 };
let pendingDeletion = null;
let undoTimer = null;
let reminderToastTimer = null;
let audioContext = null;
let activeOscillators = [];
let activeReminderTaskId = "";
let serviceWorkerReady = Promise.resolve(null);

try {
    const savedSettings = JSON.parse(localStorage.getItem(REMINDER_SETTINGS_KEY) || "null");
    if (savedSettings && typeof savedSettings === "object") {
        reminderSettings = {
            soundEnabled: savedSettings.soundEnabled !== false,
            notificationsEnabled: savedSettings.notificationsEnabled === true,
            repeatMinutes: [0, 30, 60, 120].includes(Number(savedSettings.repeatMinutes))
                ? Number(savedSettings.repeatMinutes)
                : 60
        };
    }
} catch {
    setFeedback("Reminder preferences could not be read. Default reminder settings are active.", "error");
}

function setFeedback(message, kind = "info") {
    feedback.textContent = message;
    feedback.dataset.kind = kind;
    feedback.hidden = !message;
}

function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function getToday() {
    return formatDate(new Date());
}

function isValidDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return false;
    }

    const date = new Date(`${value}T12:00:00`);
    return Number.isFinite(date.getTime()) && formatDate(date) === value;
}

function isValidTime(value) {
    return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function createId() {
    return window.crypto?.randomUUID
        ? window.crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function normalizeTask(task) {
    if (!task || typeof task.id !== "string" || typeof task.title !== "string" || !isValidDate(task.date)) {
        return null;
    }

    const legacyCategories = {
        Prayer: "Prayer & Bible Reading",
        PGCET: "PGCET Preparation",
        "College & Assignments": "College",
        Writing: "Writing Work",
        Rest: "Rest & Wellness"
    };
    const category = legacyCategories[task.category] || task.category || "Other";
    const deadline = isValidTime(task.deadline)
        ? task.deadline
        : isValidTime(task.time) ? task.time : "";
    const taskData = { ...task };
    delete taskData.description;
    delete taskData.reminderSent;
    const dueAt = new Date(`${task.date}T${deadline || DEFAULT_REMINDER_TIME}:00`).getTime();
    const lastReminderAt = typeof task.lastReminderAt === "string" && Number.isFinite(Date.parse(task.lastReminderAt))
        ? task.lastReminderAt
        : task.reminderSent === true ? new Date(dueAt - REMINDER_LEAD_TIME).toISOString() : "";
    const reminderStage = ["upcoming", "due", "overdue"].includes(task.reminderStage)
        ? task.reminderStage
        : task.reminderSent === true ? "upcoming" : "";

    return {
        ...taskData,
        title: task.title.trim().slice(0, 100),
        category: String(category).slice(0, 40),
        date: task.date,
        startTime: isValidTime(task.startTime) ? task.startTime : "",
        deadline,
        priority: VALID_PRIORITIES.includes(task.priority) ? task.priority : "normal",
        notes: typeof task.notes === "string" ? task.notes.slice(0, 240) : "",
        repeat: VALID_REPEATS.includes(task.repeat) ? task.repeat : "none",
        repeatEveryDays: Math.min(365, Math.max(1, Number(task.repeatEveryDays) || 2)),
        completed: task.completed === true,
        completedAt: typeof task.completedAt === "string" ? task.completedAt : "",
        createdAt: typeof task.createdAt === "string" ? task.createdAt : new Date().toISOString(),
        lastReminderAt,
        reminderStage,
        seriesId: typeof task.seriesId === "string" ? task.seriesId : "",
        nextOccurrenceId: typeof task.nextOccurrenceId === "string" ? task.nextOccurrenceId : ""
    };
}

try {
    const savedTasks = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    if (Array.isArray(savedTasks)) {
        const normalizedTasks = savedTasks.map(normalizeTask);
        const invalidTaskCount = normalizedTasks.filter(task => !task || !task.title).length;
        tasks = normalizedTasks.filter(task => task && task.title);
        hasLegacyDescriptions = invalidTaskCount === 0 && savedTasks.some(task =>
            task && typeof task === "object" && Object.prototype.hasOwnProperty.call(task, "description"));
        if (invalidTaskCount > 0) {
            setFeedback(`${invalidTaskCount} saved task${invalidTaskCount === 1 ? " was" : "s were"} invalid and could not be shown. Stored data was left unchanged.`, "error");
        }
    } else {
        setFeedback("Saved tasks could not be read. The stored browser data was left unchanged.", "error");
    }
} catch {
    setFeedback("Saved tasks could not be read. The stored browser data was left unchanged.", "error");
}

planDate.value = getToday();

function saveTasks() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
        return true;
    } catch {
        setFeedback("Your changes are visible in this session but could not be saved in this browser. Check available storage before closing this page.", "error");
        return false;
    }
}

function getDeadlineTimestamp(task) {
    return new Date(`${task.date}T${task.deadline || DEFAULT_REMINDER_TIME}:00`).getTime();
}

function isOverdue(task, now = Date.now()) {
    if (task.completed) {
        return false;
    }
    if (task.date < getToday()) {
        return true;
    }
    return task.date === getToday() && getDeadlineTimestamp(task) < now;
}

function formatTime(value) {
    if (!value) {
        return "";
    }
    const [hour, minute] = value.split(":").map(Number);
    return new Date(2000, 0, 1, hour, minute).toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit"
    });
}

function updateNotificationControls() {
    if (!("Notification" in window)) {
        notificationButton.disabled = true;
        notificationButton.textContent = "Notifications unavailable";
        notificationStatus.textContent = "In-page reminders are on; this browser does not support desktop notifications.";
        return;
    }

    const permission = Notification.permission;
    const isEnabled = permission === "granted" && reminderSettings.notificationsEnabled;
    notificationButton.disabled = permission === "denied";
    notificationButton.setAttribute("aria-pressed", String(isEnabled));
    notificationButton.textContent = permission === "denied"
        ? "Notifications blocked"
        : isEnabled ? "Desktop alerts on · pause" : "Enable desktop alerts";
    notificationStatus.textContent = permission === "denied"
        ? "In-page reminders are on; allow notifications in your browser settings to enable desktop alerts."
        : isEnabled
            ? "In-page and desktop alerts are on while the planner is open."
            : "In-page reminders are on; desktop notifications are optional.";
}

function saveReminderSettings() {
    try {
        localStorage.setItem(REMINDER_SETTINGS_KEY, JSON.stringify(reminderSettings));
        return true;
    } catch {
        notificationStatus.textContent = "Reminder settings changed for this session but could not be saved in this browser.";
        return false;
    }
}

function registerReminderServiceWorker() {
    if (!("serviceWorker" in navigator) || !window.isSecureContext) {
        return Promise.resolve(null);
    }

    return navigator.serviceWorker.register("./sw.js")
        .then(registration => registration)
        .catch(() => {
            notificationStatus.textContent = "In-page alerts work, but this browser could not set up screen notifications.";
            return null;
        });
}

function getReminderMessage(task, stage, now) {
    if (stage === "upcoming") {
        const minutesUntilDue = Math.max(1, Math.ceil((getDeadlineTimestamp(task) - now) / 60000));
        return `“${task.title}” is due in ${minutesUntilDue} minute${minutesUntilDue === 1 ? "" : "s"}.`;
    }
    if (stage === "due" && now - getDeadlineTimestamp(task) < 60000) {
        return `“${task.title}” is due now.`;
    }
    return stage === "due"
        ? `“${task.title}” was due at ${formatTime(task.deadline || DEFAULT_REMINDER_TIME)}.`
        : `“${task.title}” is overdue. Please review it when you can.`;
}

async function showPlatformNotification(task, message) {
    if (!reminderSettings.notificationsEnabled || !("Notification" in window) || Notification.permission !== "granted") {
        return;
    }

    try {
        const registration = await serviceWorkerReady;
        if (registration && "showNotification" in registration) {
            await registration.showNotification("Daymark reminder", {
                body: message,
                icon: "./logo.svg",
                badge: "./logo.svg",
                tag: `task-reminder-${task.id}`,
                data: { url: "./" }
            });
            return;
        }

        new Notification("Daymark reminder", {
            body: message,
            icon: "./logo.svg",
            tag: `task-reminder-${task.id}`
        });
    } catch {
        notificationStatus.textContent = "In-page reminder shown; this device could not display a desktop notification.";
    }
}

function stopReminderSound() {
    activeOscillators.forEach(oscillator => {
        try {
            oscillator.stop();
        } catch {
            // An oscillator that has already stopped needs no further action.
        }
    });
    activeOscillators = [];
}

async function prepareAudio() {
    if (!("AudioContext" in window) && !("webkitAudioContext" in window)) {
        return null;
    }
    const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
    audioContext = audioContext || new AudioContextConstructor();
    if (audioContext.state === "suspended") {
        await audioContext.resume();
    }
    return audioContext;
}

async function playReminderSound(force = false) {
    if (!force && !reminderSettings.soundEnabled) {
        return;
    }

    try {
        const context = await prepareAudio();
        if (!context || context.state !== "running") {
            notificationStatus.textContent = "Sound is unavailable until you tap Test sound on this device.";
            return;
        }

        stopReminderSound();
        const startAt = context.currentTime;
        [659.25, 783.99, 987.77, 783.99].forEach((frequency, index) => {
            const start = startAt + index * 0.22;
            const oscillator = context.createOscillator();
            const volume = context.createGain();
            oscillator.type = "sine";
            oscillator.frequency.setValueAtTime(frequency, start);
            volume.gain.setValueAtTime(0.0001, start);
            volume.gain.linearRampToValueAtTime(0.11, start + 0.035);
            volume.gain.exponentialRampToValueAtTime(0.0001, start + 0.19);
            oscillator.connect(volume);
            volume.connect(context.destination);
            oscillator.start(start);
            oscillator.stop(start + 0.2);
            activeOscillators.push(oscillator);
        });
    } catch {
        notificationStatus.textContent = "Reminder sound could not play. Use Test sound to check this device's audio.";
    }
}

function showReminder(task, stage, now) {
    activeReminderTaskId = task.id;
    const message = getReminderMessage(task, stage, now);
    reminderMessage.textContent = message;
    reminderToast.classList.add("is-visible");
    notificationStatus.textContent = message;
    notificationStatus.classList.add("reminder-active");
    void showPlatformNotification(task, message);
    void playReminderSound();

    window.clearTimeout(reminderToastTimer);
    reminderToastTimer = window.setTimeout(() => {
        reminderToast.classList.remove("is-visible");
        notificationStatus.classList.remove("reminder-active");
        updateNotificationControls();
    }, 12000);
}

document.getElementById("dismissReminder").addEventListener("click", () => {
    reminderToast.classList.remove("is-visible");
    stopReminderSound();
    activeReminderTaskId = "";
});

function checkReminders() {
    const now = Date.now();
    let changed = false;

    tasks.forEach(task => {
        if (task.completed) {
            return;
        }

        const dueAt = getDeadlineTimestamp(task);
        const lastReminderAt = Date.parse(task.lastReminderAt);
        const nextReminderAt = task.reminderStage === "upcoming"
            ? dueAt
            : task.reminderStage === "due" || task.reminderStage === "overdue"
                ? reminderSettings.repeatMinutes === 0 || !Number.isFinite(lastReminderAt)
                    ? Number.POSITIVE_INFINITY
                    : lastReminderAt + reminderSettings.repeatMinutes * 60 * 1000
                : dueAt > now ? dueAt - REMINDER_LEAD_TIME : dueAt;
        if (now >= nextReminderAt) {
            const stage = task.reminderStage === "due" || task.reminderStage === "overdue"
                ? "overdue"
                : now < dueAt ? "upcoming" : "due";
            task.lastReminderAt = new Date(now).toISOString();
            task.reminderStage = stage;
            changed = true;
            showReminder(task, stage, now);
        }
    });

    if (changed) {
        saveTasks();
        renderTasks();
    }
}

function updateSummary(dailyTasks) {
    const completed = dailyTasks.filter(task => task.completed).length;
    const overdue = dailyTasks.filter(task => isOverdue(task)).length;
    const total = dailyTasks.length;
    const percentage = total === 0 ? 0 : Math.round((completed / total) * 100);

    document.getElementById("totalCount").textContent = total;
    document.getElementById("completedCount").textContent = completed;
    document.getElementById("pendingCount").textContent = total - completed;
    document.getElementById("overdueCount").textContent = overdue;
    document.getElementById("progressPercent").textContent = `${percentage}%`;
    document.getElementById("progressBar").style.width = `${percentage}%`;
    document.querySelector(".progress-track").setAttribute("aria-valuenow", percentage);
}

function compareTasks(first, second) {
    const firstTime = getDeadlineTimestamp(first) ?? Number.MAX_SAFE_INTEGER;
    const secondTime = getDeadlineTimestamp(second) ?? Number.MAX_SAFE_INTEGER;
    return firstTime - secondTime || first.title.localeCompare(second.title);
}

function updateCategoryFilter() {
    const selectedCategory = categoryFilter.value;
    const categories = [...new Set(tasks.map(task => task.category))]
        .sort((first, second) => first.localeCompare(second));
    categoryFilter.replaceChildren(
        new Option("All categories", "all"),
        ...categories.map(category => new Option(category, category))
    );
    categoryFilter.value = categories.includes(selectedCategory) ? selectedCategory : "all";
}

function filterTasks(dailyTasks) {
    const query = document.getElementById("taskSearch").value.trim().toLocaleLowerCase();
    const status = document.getElementById("taskStatusFilter").value;
    const selectedCategory = categoryFilter.value;
    const sort = sortControl.value;

    const visibleTasks = dailyTasks.filter(task => {
        const matchesQuery = !query || [task.title, task.category, task.notes]
            .some(value => value.toLocaleLowerCase().includes(query));
        const matchesStatus = status === "all"
            || (status === "pending" && !task.completed)
            || (status === "completed" && task.completed)
            || (status === "overdue" && isOverdue(task));
        const matchesCategory = selectedCategory === "all" || task.category === selectedCategory;
        return matchesQuery && matchesStatus && matchesCategory;
    });

    if (sort === "priority") {
        const priorityOrder = { high: 0, normal: 1, low: 2 };
        return visibleTasks.sort((first, second) =>
            priorityOrder[first.priority] - priorityOrder[second.priority] || compareTasks(first, second));
    }
    if (sort === "title") {
        return visibleTasks.sort((first, second) =>
            first.title.localeCompare(second.title) || compareTasks(first, second));
    }
    return visibleTasks.sort(compareTasks);
}

function makeEmptyState(hasTasks) {
    const emptyState = document.createElement("li");
    emptyState.className = "empty-state";

    const mark = document.createElement("span");
    mark.className = "empty-mark";
    mark.setAttribute("aria-hidden", "true");
    mark.textContent = "✳";

    const heading = document.createElement("strong");
    heading.textContent = hasTasks ? "No tasks match." : "A clear page.";

    const note = document.createElement("span");
    note.textContent = hasTasks
        ? "Try another search or filter."
        : "Add a task above to get started.";
    emptyState.append(mark, heading, note);
    return emptyState;
}

function createTaskRow(task) {
    const item = document.createElement("li");
    item.className = "task";
    if (task.completed) {
        item.classList.add("completed");
    }
    if (isOverdue(task)) {
        item.classList.add("overdue");
    }
    item.classList.add(`priority-${task.priority}`);

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = task.completed;
    checkbox.setAttribute("aria-label", task.completed
        ? `Restore ${task.title} to pending`
        : `Mark ${task.title} complete`);
    checkbox.addEventListener("change", () => {
        task.completed = checkbox.checked;
        task.completedAt = task.completed ? new Date().toISOString() : "";
        if (task.completed) {
            createNextOccurrence(task);
            if (activeReminderTaskId === task.id) {
                stopReminderSound();
                activeReminderTaskId = "";
                reminderToast.classList.remove("is-visible");
            }
        }
        saveTasks();
        renderTasks();
    });

    const info = document.createElement("div");
    info.className = "task-info";

    const titleLine = document.createElement("div");
    titleLine.className = "task-title-line";
    const title = document.createElement("span");
    title.className = "task-title";
    title.textContent = task.title;
    const priority = document.createElement("span");
    priority.className = `priority-badge ${task.priority}`;
    priority.textContent = task.priority;
    titleLine.append(title, priority);

    const meta = document.createElement("small");
    const schedule = [];
    if (task.startTime) {
        schedule.push(`Starts ${formatTime(task.startTime)}`);
    }
    if (task.deadline) {
        schedule.push(`Due ${formatTime(task.deadline)}`);
    } else {
        schedule.push("Due by 9:00 PM");
    }
    const repeatLabels = { daily: "Repeats daily", weekly: "Repeats weekly" };
    if (task.repeat === "custom") {
        repeatLabels.custom = `Repeats every ${task.repeatEveryDays} days`;
    }
    const category = document.createElement("span");
    category.className = "category-chip";
    category.dataset.category = task.category;
    category.textContent = task.category;
    meta.append(category, document.createTextNode(
        [...schedule, repeatLabels[task.repeat]].filter(Boolean).join(" · ")
    ));

    info.append(titleLine, meta);
    if (task.notes) {
        const notes = document.createElement("p");
        notes.className = "task-notes";
        notes.textContent = task.notes;
        info.appendChild(notes);
    }

    const actions = document.createElement("div");
    actions.className = "task-actions";
    const editButton = document.createElement("button");
    editButton.className = "edit-button";
    editButton.type = "button";
    editButton.textContent = "Edit";
    editButton.setAttribute("aria-label", `Edit ${task.title}`);
    editButton.addEventListener("click", () => startEditing(task));

    const deleteButton = document.createElement("button");
    deleteButton.className = "delete-button";
    deleteButton.type = "button";
    deleteButton.textContent = "Delete";
    deleteButton.setAttribute("aria-label", `Delete ${task.title}`);
    deleteButton.addEventListener("click", () => deleteTask(task));

    actions.append(editButton, deleteButton);
    item.append(checkbox, info, actions);
    return item;
}

function renderTasks() {
    taskList.replaceChildren();
    updateCategoryFilter();
    const dailyTasks = tasks.filter(task => task.date === planDate.value);
    const visibleTasks = filterTasks(dailyTasks);
    updateSummary(dailyTasks);

    if (visibleTasks.length === 0) {
        taskList.appendChild(makeEmptyState(dailyTasks.length > 0));
        return;
    }

    visibleTasks.forEach(task => taskList.appendChild(createTaskRow(task)));
}

function startEditing(task) {
    form.dataset.editingId = task.id;
    document.getElementById("taskTitle").value = task.title;
    document.getElementById("taskStartTime").value = task.startTime;
    document.getElementById("taskDeadline").value = task.deadline;
    document.getElementById("taskPriority").value = task.priority;
    document.getElementById("taskRepeat").value = task.repeat;
    document.getElementById("repeatEveryDays").value = task.repeatEveryDays;
    document.getElementById("taskNotes").value = task.notes;

    const categorySelect = document.getElementById("taskCategory");
    const categoryOption = [...categorySelect.options].find(option => option.value === task.category);
    if (categoryOption) {
        categorySelect.value = task.category;
        document.getElementById("customCategory").value = "";
    } else {
        categorySelect.value = "Custom";
        document.getElementById("customCategory").value = task.category;
    }

    updateConditionalFields();
    submitButton.textContent = "Save changes";
    cancelEditButton.hidden = false;
    setFeedback("Editing task. Save changes or cancel.");
    document.getElementById("taskTitle").focus();
    form.scrollIntoView({ behavior: "smooth", block: "center" });
}

function stopEditing() {
    delete form.dataset.editingId;
    form.reset();
    submitButton.textContent = "Add task";
    cancelEditButton.hidden = true;
    updateConditionalFields();
}

function updateConditionalFields() {
    customCategoryField.hidden = document.getElementById("taskCategory").value !== "Custom";
    repeatIntervalField.hidden = document.getElementById("taskRepeat").value !== "custom";
}

function getNextDate(date, repeat, everyDays) {
    const nextDate = new Date(`${date}T12:00:00`);
    const days = repeat === "daily" ? 1 : repeat === "weekly" ? 7 : everyDays;
    nextDate.setDate(nextDate.getDate() + days);
    return formatDate(nextDate);
}

function createNextOccurrence(task) {
    if (task.repeat === "none" || task.nextOccurrenceId) {
        return;
    }

    const nextTask = {
        ...task,
        id: createId(),
        date: getNextDate(task.date, task.repeat, task.repeatEveryDays),
        completed: false,
        completedAt: "",
        lastReminderAt: "",
        reminderStage: "",
        createdAt: new Date().toISOString(),
        seriesId: task.seriesId || task.id,
        nextOccurrenceId: ""
    };
    task.nextOccurrenceId = nextTask.id;
    tasks.push(nextTask);
}

function deleteTask(task) {
    if (!window.confirm(`Delete “${task.title}”? You can undo this for a few seconds.`)) {
        return;
    }

    const index = tasks.findIndex(item => item.id === task.id);
    if (index < 0) {
        return;
    }

    tasks.splice(index, 1);
    pendingDeletion = { task, index };
    document.getElementById("undoMessage").textContent = `“${task.title}” deleted.`;
    document.getElementById("undoToast").classList.add("is-visible");
    window.clearTimeout(undoTimer);
    undoTimer = window.setTimeout(() => {
        pendingDeletion = null;
        document.getElementById("undoToast").classList.remove("is-visible");
    }, 8000);

    if (form.dataset.editingId === task.id) {
        stopEditing();
    }
    saveTasks();
    renderTasks();
}

document.getElementById("undoDeleteButton").addEventListener("click", () => {
    if (!pendingDeletion) {
        return;
    }
    tasks.splice(pendingDeletion.index, 0, pendingDeletion.task);
    pendingDeletion = null;
    window.clearTimeout(undoTimer);
    document.getElementById("undoToast").classList.remove("is-visible");
    saveTasks();
    renderTasks();
});

form.addEventListener("submit", event => {
    event.preventDefault();
    setFeedback("");

    const title = document.getElementById("taskTitle").value.trim();
    const categorySelect = document.getElementById("taskCategory").value;
    const category = categorySelect === "Custom"
        ? document.getElementById("customCategory").value.trim()
        : categorySelect;
    const startTime = document.getElementById("taskStartTime").value;
    const deadline = document.getElementById("taskDeadline").value;
    const repeat = document.getElementById("taskRepeat").value;
    const repeatEveryDays = Number(document.getElementById("repeatEveryDays").value);

    if (!title) {
        setFeedback("Add a task title before saving.", "error");
        document.getElementById("taskTitle").focus();
        return;
    }
    if (!isValidDate(planDate.value)) {
        setFeedback("Choose a valid planning date before saving.", "error");
        planDate.focus();
        return;
    }
    if (!category) {
        setFeedback("Enter a name for your custom category.", "error");
        document.getElementById("customCategory").focus();
        return;
    }
    if (startTime && deadline && startTime >= deadline) {
        setFeedback("The start time must be earlier than the deadline.", "error");
        document.getElementById("taskDeadline").focus();
        return;
    }
    if (repeat === "custom" && (!Number.isInteger(repeatEveryDays) || repeatEveryDays < 1 || repeatEveryDays > 365)) {
        setFeedback("Choose a repeat interval between 1 and 365 days.", "error");
        document.getElementById("repeatEveryDays").focus();
        return;
    }

    const editingTask = tasks.find(task => task.id === form.dataset.editingId);
    const nextTask = {
        id: editingTask?.id || createId(),
        title,
        category,
        date: planDate.value,
        startTime,
        deadline,
        priority: document.getElementById("taskPriority").value,
        notes: document.getElementById("taskNotes").value.trim(),
        repeat,
        repeatEveryDays: repeat === "custom" ? repeatEveryDays : 2,
        completed: editingTask?.completed || false,
        completedAt: editingTask?.completedAt || "",
        createdAt: editingTask?.createdAt || new Date().toISOString(),
        lastReminderAt: editingTask && editingTask.date === planDate.value && editingTask.deadline === deadline
            ? editingTask.lastReminderAt
            : "",
        reminderStage: editingTask && editingTask.date === planDate.value && editingTask.deadline === deadline
            ? editingTask.reminderStage
            : "",
        seriesId: editingTask?.seriesId || "",
        nextOccurrenceId: editingTask?.nextOccurrenceId || ""
    };

    if (editingTask) {
        tasks[tasks.indexOf(editingTask)] = nextTask;
    } else {
        tasks.push(nextTask);
    }

    const saved = saveTasks();
    stopEditing();
    if (saved) {
        setFeedback(editingTask ? "Task updated." : "Task added.");
        window.setTimeout(() => setFeedback(""), 3000);
    }
    renderTasks();
});

cancelEditButton.addEventListener("click", () => {
    stopEditing();
    setFeedback("Task edit canceled.");
});

document.getElementById("taskCategory").addEventListener("change", updateConditionalFields);
document.getElementById("taskRepeat").addEventListener("change", updateConditionalFields);
planDate.addEventListener("change", () => {
    if (form.dataset.editingId) {
        stopEditing();
    }
    renderTasks();
});

document.getElementById("taskSearch").addEventListener("input", renderTasks);
["taskStatusFilter", "taskCategoryFilter", "taskSort"].forEach(id => {
    document.getElementById(id).addEventListener("change", renderTasks);
});

notificationButton.addEventListener("click", async () => {
    if (!("Notification" in window) || Notification.permission === "denied") {
        return;
    }

    if (Notification.permission === "granted") {
        reminderSettings.notificationsEnabled = !reminderSettings.notificationsEnabled;
        const saved = saveReminderSettings();
        updateNotificationControls();
        if (!saved) {
            notificationStatus.textContent = "Alert preference changed for this session but could not be saved.";
        }
        return;
    }

    try {
        const permission = await Notification.requestPermission();
        reminderSettings.notificationsEnabled = permission === "granted";
        const saved = saveReminderSettings();
        updateNotificationControls();
        if (permission !== "granted") {
            notificationStatus.textContent = "Notifications were not allowed. In-page reminders and sound remain available.";
        } else if (!saved) {
            notificationStatus.textContent = "Alerts are enabled for this session but the preference could not be saved.";
        }
    } catch {
        notificationStatus.textContent = "Desktop alerts could not be enabled; in-page reminders remain on.";
    }
});

function unlockAudioFromGesture() {
    if (!audioContext) {
        void prepareAudio().catch(() => {
            notificationStatus.textContent = "Sound is unavailable until you tap Test sound on this device.";
        });
    }
}

document.addEventListener("pointerdown", unlockAudioFromGesture, { once: true });
document.addEventListener("keydown", unlockAudioFromGesture, { once: true });

soundToggle.checked = reminderSettings.soundEnabled;
overdueRepeat.value = String(reminderSettings.repeatMinutes);
soundToggle.addEventListener("change", () => {
    reminderSettings.soundEnabled = soundToggle.checked;
    saveReminderSettings();
});
overdueRepeat.addEventListener("change", () => {
    reminderSettings.repeatMinutes = Number(overdueRepeat.value);
    saveReminderSettings();
});
testReminderSoundButton.addEventListener("click", () => {
    void playReminderSound(true);
});

const themeToggle = document.getElementById("themeToggle");
function applyTheme(theme) {
    const isDark = theme === "dark";
    document.body.classList.toggle("dark-theme", isDark);
    themeToggle.setAttribute("aria-pressed", String(isDark));
    themeToggle.textContent = isDark ? "☼ Light mode" : "◐ Dark mode";
}

let savedTheme = "light";
try {
    savedTheme = localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";
} catch {
    savedTheme = "light";
}
applyTheme(savedTheme);
themeToggle.addEventListener("click", () => {
    const nextTheme = document.body.classList.contains("dark-theme") ? "light" : "dark";
    applyTheme(nextTheme);
    try {
        localStorage.setItem(THEME_KEY, nextTheme);
    } catch {
        setFeedback("Theme changed for this session but could not be saved.", "error");
    }
});

updateConditionalFields();
updateNotificationControls();
serviceWorkerReady = registerReminderServiceWorker();
if (hasLegacyDescriptions && saveTasks()) {
    setFeedback("Removed the retired description field from saved tasks.");
}
renderTasks();
checkReminders();
window.setInterval(checkReminders, 15000);