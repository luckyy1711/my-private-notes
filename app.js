// --- SUPABASE CONFIGURATION ---
// IMPORTANT: Replace with your Supabase Publishable Key
const SUPABASE_URL = 'https://neadherlqwnqafiwalov.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_VA8wWt0-R6IFPPPYfW0Bdg_LS0NYrl4';

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// --- GLOBAL STATE ---
let currentUser = null;
let notes = [];
let folders = [];
let currentNoteId = null;
let currentFilter = 'all'; // all, favorites, recent, folder_id
let quill;
let saveTimeout = null;

// --- DOM ELEMENTS ---
const authView = document.getElementById('auth-view');
const appView = document.getElementById('app-view');
const loginForm = document.getElementById('login-form');
const authError = document.getElementById('auth-error');
const logoutBtn = document.getElementById('logout-btn');

const notesListContainer = document.getElementById('notes-list-container');
const folderList = document.getElementById('folder-list');
const noteCountEl = document.getElementById('note-count');
const currentViewTitle = document.getElementById('current-view-title');

const editorEmpty = document.getElementById('editor-empty');
const editorActive = document.getElementById('editor-active');
const noteTitleInput = document.getElementById('note-title-input');
const saveStatus = document.getElementById('save-status');

// Modals / Panels
const searchModal = document.getElementById('search-modal');
const globalSearchInput = document.getElementById('global-search-input');
const searchResults = document.getElementById('search-results');
const sidebar = document.getElementById('sidebar');
const editorPanel = document.getElementById('editor-panel');

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async () => {
    initTheme();
    initQuill();
    setupEventListeners();
    
    // Check initial auth state
    const { data: { session } } = await supabase.auth.getSession();
    handleAuthChange(session);

    // Listen for auth changes
    supabase.auth.onAuthStateChange((_event, session) => {
        handleAuthChange(session);
    });
});

// --- AUTHENTICATION ---
async function handleAuthChange(session) {
    if (session) {
        currentUser = session.user;
        authView.classList.add('hidden');
        appView.classList.remove('hidden');
        await loadData();
    } else {
        currentUser = null;
        authView.classList.remove('hidden');
        appView.classList.add('hidden');
    }
}

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const btn = document.getElementById('login-btn');
    
    btn.textContent = 'Signing In...';
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    
    if (error) {
        authError.textContent = error.message;
        btn.textContent = 'Sign In';
    }
});

logoutBtn.addEventListener('click', async () => {
    await supabase.auth.signOut();
});

// --- DATA FETCHING ---
async function loadData() {
    await Promise.all([fetchFolders(), fetchNotes()]);
    renderFolders();
    renderNotes();
}

async function fetchFolders() {
    const { data, error } = await supabase
        .from('folders')
        .select('*')
        .order('name');
    if (!error) folders = data;
}

async function fetchNotes() {
    const { data, error } = await supabase
        .from('notes')
        .select('*')
        .order('updated_at', { ascending: false });
    if (!error) notes = data;
}

// --- RENDER LOGIC ---
function renderFolders() {
    folderList.innerHTML = '';
    folders.forEach(folder => {
        const li = document.createElement('li');
        li.className = `nav-item ${currentFilter === folder.id ? 'active' : ''}`;
        li.innerHTML = `<i class="ph ph-folder"></i> ${folder.name}`;
        li.onclick = () => setFilter(folder.id, folder.name);
        folderList.appendChild(li);
    });
}

function renderNotes() {
    notesListContainer.innerHTML = '';
    
    let filteredNotes = notes;
    if (currentFilter === 'favorites') {
        filteredNotes = notes.filter(n => n.is_favorite);
    } else if (currentFilter === 'recent') {
        // Just sort by updated_at (default)
    } else if (currentFilter !== 'all') {
        filteredNotes = notes.filter(n => n.folder_id === currentFilter);
    }

    // Apply Sorting
    const sortVal = document.getElementById('sort-select').value;
    if (sortVal === 'created') {
        filteredNotes.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    } else if (sortVal === 'alpha') {
        filteredNotes.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    } else {
        filteredNotes.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
    }

    noteCountEl.textContent = `${filteredNotes.length} notes`;

    filteredNotes.forEach(note => {
        const div = document.createElement('div');
        div.className = `note-card ${currentNoteId === note.id ? 'active' : ''}`;
        
        // Strip HTML for preview
        const tmp = document.createElement('div');
        tmp.innerHTML = note.content || '';
        const previewText = tmp.textContent || tmp.innerText || 'No additional text';

        const date = new Date(note.updated_at).toLocaleDateString();

        div.innerHTML = `
            <div class="note-card-header">
                <div class="note-card-title">${note.title || 'Untitled Note'}</div>
                ${note.is_pinned ? '<i class="ph-fill ph-push-pin" style="color:var(--text-secondary)"></i>' : ''}
            </div>
            <div class="note-card-preview">${previewText}</div>
            <div class="note-card-meta">
                <span>${date}</span>
            </div>
        `;
        div.onclick = () => openNote(note.id);
        notesListContainer.appendChild(div);
    });
}

function setFilter(filter, title = null) {
    currentFilter = filter;
    document.querySelectorAll('.sidebar-nav .nav-item').forEach(el => el.classList.remove('active'));
    
    // Attempt to set active class in sidebar visually
    if (filter === 'all') document.querySelector('[data-filter="all"]').classList.add('active');
    else if (filter === 'favorites') document.querySelector('[data-filter="favorites"]').classList.add('active');
    else if (filter === 'recent') document.querySelector('[data-filter="recent"]').classList.add('active');
    
    currentViewTitle.textContent = title || (filter.charAt(0).toUpperCase() + filter.slice(1));
    
    // Close sidebar on mobile
    sidebar.classList.remove('open');
    renderNotes();
}

// --- EDITOR LOGIC ---
function initQuill() {
    quill = new Quill('#quill-editor', {
        theme: 'bubble',
        placeholder: 'Start typing here...',
        modules: {
            toolbar: [
                ['bold', 'italic', 'underline', 'strike'],
                [{ 'header': 1 }, { 'header': 2 }],
                [{ 'list': 'ordered'}, { 'list': 'bullet' }],
                ['blockquote', 'code-block'],
                ['link']
            ]
        }
    });

    quill.on('text-change', () => scheduleSave());
    noteTitleInput.addEventListener('input', () => scheduleSave(true));
}

function openNote(id) {
    currentNoteId = id;
    const note = notes.find(n => n.id === id);
    
    if (!note) return;

    editorEmpty.classList.add('hidden');
    editorActive.classList.remove('hidden');
    
    // Populate
    noteTitleInput.value = note.title || '';
    quill.root.innerHTML = note.content || '';
    
    // Toggle UI States
    updateFavoritePinIcons(note);

    renderNotes(); // Update active class in list
    
    // Mobile panel slide
    if (window.innerWidth <= 768) {
        editorPanel.classList.add('open');
    }
}

async function createNewNote() {
    const newNote = {
        user_id: currentUser.id,
        title: '',
        content: '',
        folder_id: currentFilter !== 'all' && currentFilter !== 'favorites' && currentFilter !== 'recent' ? currentFilter : null,
    };

    const { data, error } = await supabase.from('notes').insert(newNote).select().single();
    
    if (!error && data) {
        notes.unshift(data);
        openNote(data.id);
        noteTitleInput.focus();
    }
}

// Auto-Save Logic
function scheduleSave(updateListImmediately = false) {
    saveStatus.textContent = 'Saving...';
    if (saveTimeout) clearTimeout(saveTimeout);
    
    saveTimeout = setTimeout(() => saveNote(updateListImmediately), 1000);
}

async function saveNote(updateListImmediately) {
    if (!currentNoteId) return;

    const title = noteTitleInput.value;
    const content = quill.root.innerHTML;

    const { error } = await supabase
        .from('notes')
        .update({ title, content })
        .eq('id', currentNoteId);

    if (!error) {
        saveStatus.textContent = 'Saved';
        // Update local state
        const noteIndex = notes.findIndex(n => n.id === currentNoteId);
        if (noteIndex > -1) {
            notes[noteIndex].title = title;
            notes[noteIndex].content = content;
            notes[noteIndex].updated_at = new Date().toISOString();
        }
        if (updateListImmediately) renderNotes();
    } else {
        saveStatus.textContent = 'Error saving';
    }
}

// --- NOTE ACTIONS (DELETE/FAV/PIN) ---
async function toggleFavorite() {
    if (!currentNoteId) return;
    const note = notes.find(n => n.id === currentNoteId);
    const newVal = !note.is_favorite;
    
    const { error } = await supabase.from('notes').update({ is_favorite: newVal }).eq('id', currentNoteId);
    if (!error) {
        note.is_favorite = newVal;
        updateFavoritePinIcons(note);
        renderNotes();
    }
}

async function togglePin() {
    if (!currentNoteId) return;
    const note = notes.find(n => n.id === currentNoteId);
    const newVal = !note.is_pinned;
    
    const { error } = await supabase.from('notes').update({ is_pinned: newVal }).eq('id', currentNoteId);
    if (!error) {
        note.is_pinned = newVal;
        updateFavoritePinIcons(note);
        renderNotes();
    }
}

async function deleteNote() {
    if (!currentNoteId) return;
    if (!confirm('Are you sure you want to delete this note?')) return;

    const { error } = await supabase.from('notes').delete().eq('id', currentNoteId);
    if (!error) {
        notes = notes.filter(n => n.id !== currentNoteId);
        currentNoteId = null;
        editorActive.classList.add('hidden');
        editorEmpty.classList.remove('hidden');
        
        // Mobile panel close
        editorPanel.classList.remove('open');
        
        renderNotes();
        document.getElementById('more-options-menu').classList.add('hidden');
    }
}

function updateFavoritePinIcons(note) {
    const favBtn = document.getElementById('toggle-favorite-btn');
    const pinBtn = document.getElementById('toggle-pin-btn');
    
    if (note.is_favorite) favBtn.classList.add('active');
    else favBtn.classList.remove('active');

    if (note.is_pinned) pinBtn.classList.add('active');
    else pinBtn.classList.remove('active');
}

// --- FOLDER ACTIONS ---
async function createFolder() {
    const name = prompt('Folder name:');
    if (!name) return;

    const { data, error } = await supabase.from('folders').insert({ user_id: currentUser.id, name }).select().single();
    if (!error && data) {
        folders.push(data);
        renderFolders();
    }
}

// --- SEARCH ---
function toggleSearchModal(show) {
    if (show) {
        searchModal.classList.remove('hidden');
        globalSearchInput.focus();
        performSearch('');
    } else {
        searchModal.classList.add('hidden');
        globalSearchInput.value = '';
    }
}

function performSearch(query) {
    query = query.toLowerCase();
    searchResults.innerHTML = '';
    
    if (!query) return;

    const results = notes.filter(n => 
        (n.title && n.title.toLowerCase().includes(query)) || 
        (n.content && n.content.toLowerCase().includes(query))
    ).slice(0, 10); // Limit 10

    results.forEach(note => {
        const div = document.createElement('div');
        div.className = 'search-result-item';
        div.innerHTML = `
            <strong>${note.title || 'Untitled'}</strong>
            <span style="font-size: 12px; color: var(--text-tertiary);">${new Date(note.updated_at).toLocaleDateString()}</span>
        `;
        div.onclick = () => {
            toggleSearchModal(false);
            openNote(note.id);
        };
        searchResults.appendChild(div);
    });
}

// --- THEME ---
function initTheme() {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark' || (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        document.documentElement.setAttribute('data-theme', 'dark');
    } else {
        document.documentElement.removeAttribute('data-theme');
    }
}

function toggleTheme() {
    if (document.documentElement.hasAttribute('data-theme')) {
        document.documentElement.removeAttribute('data-theme');
        localStorage.setItem('theme', 'light');
    } else {
        document.documentElement.setAttribute('data-theme', 'dark');
        localStorage.setItem('theme', 'dark');
    }
}

// --- EVENT LISTENERS ---
function setupEventListeners() {
    // Sidebar static filters
    document.querySelectorAll('.sidebar-nav .nav-item[data-filter]').forEach(el => {
        el.addEventListener('click', (e) => setFilter(e.currentTarget.dataset.filter));
    });

    // Mobile nav
    document.getElementById('mobile-menu-btn').addEventListener('click', () => {
        sidebar.classList.add('open');
    });
    document.getElementById('sidebar-close-btn').addEventListener('click', () => {
        sidebar.classList.remove('open');
    });
    document.getElementById('back-to-list-btn').addEventListener('click', () => {
        editorPanel.classList.remove('open');
    });

    // Buttons
    document.querySelectorAll('.new-note-btn').forEach(btn => btn.addEventListener('click', createNewNote));
    document.getElementById('new-folder-btn').addEventListener('click', createFolder);
    document.getElementById('theme-toggle').addEventListener('click', toggleTheme);
    document.getElementById('sort-select').addEventListener('change', renderNotes);

    // Note Action Buttons
    document.getElementById('toggle-favorite-btn').addEventListener('click', toggleFavorite);
    document.getElementById('toggle-pin-btn').addEventListener('click', togglePin);
    
    // More Options Dropdown
    const moreBtn = document.getElementById('more-options-btn');
    const moreMenu = document.getElementById('more-options-menu');
    moreBtn.addEventListener('click', () => moreMenu.classList.toggle('hidden'));
    document.addEventListener('click', (e) => {
        if (!moreBtn.contains(e.target) && !moreMenu.contains(e.target)) {
            moreMenu.classList.add('hidden');
        }
    });
    
    document.getElementById('delete-note-action').addEventListener('click', (e) => {
        e.preventDefault();
        deleteNote();
    });
    document.getElementById('duplicate-note-action').addEventListener('click', async (e) => {
        e.preventDefault();
        if (!currentNoteId) return;
        const note = notes.find(n => n.id === currentNoteId);
        const { data, error } = await supabase.from('notes').insert({
            user_id: currentUser.id,
            folder_id: note.folder_id,
            title: note.title + ' (Copy)',
            content: note.content
        }).select().single();
        if (!error && data) {
            notes.unshift(data);
            renderNotes();
            openNote(data.id);
            moreMenu.classList.add('hidden');
        }
    });

    // Search
    document.getElementById('global-search-btn').addEventListener('click', () => toggleSearchModal(true));
    globalSearchInput.addEventListener('input', (e) => performSearch(e.target.value));
    
    searchModal.addEventListener('click', (e) => {
        if (e.target === searchModal) toggleSearchModal(false);
    });

    // Global Cmd+K / Esc
    document.addEventListener('keydown', (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
            e.preventDefault();
            toggleSearchModal(true);
        }
        if (e.key === 'Escape' && !searchModal.classList.contains('hidden')) {
            toggleSearchModal(false);
        }
    });
}
