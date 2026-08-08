// 1. INITIALIZATION & ENV CONFIG
const SUPABASE_URL = "https://fchlbqtxibtkbxfvlacp.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_W04KgV_X9x4u3hkbbqLavQ_dyJFVrnL"; // Safe for frontend use

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUser = null;
let userRole = null;
let realtimeSubscription = null;

// 2. AUTHENTICATION CONTROLLER
async function login(email, password) {
  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    
    await fetchUserProfile(data.user.id);
    await logAuditEvent('USER_LOGIN', { email });
    initRealtimeSync();
    renderAppInterface();
  } catch (err) {
    showError("Authentication Failed", err.message);
  }
}

async function logout() {
  if (currentUser) {
    await logAuditEvent('USER_LOGOUT', { userId: currentUser.id });
  }
  if (realtimeSubscription) supabase.removeChannel(realtimeSubscription);
  await supabase.auth.signOut();
  currentUser = null;
  userRole = null;
  renderAuthInterface();
}

async function fetchUserProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (error) throw error;
  currentUser = data;
  userRole = data.role;
}

// 3. SECURE DATA STORAGE & RETRIEVAL (CRUD)
async function fetchRecords() {
  try {
    const { data, error } = await supabase
      .from('app_records')
      .select(`
        *,
        creator:profiles!created_by(full_name, email)
      `)
      .order('created_at', { ascending: false });

    if (error) throw error;
    renderRecordsList(data);
  } catch (err) {
    showError("Failed to fetch cloud records", err.message);
  }
}

async function createRecord(title, description, payload = {}) {
  try {
    const newRecord = {
      title,
      description,
      payload,
      created_by: currentUser.id,
      updated_by: currentUser.id
    };

    const { data, error } = await supabase
      .from('app_records')
      .insert([newRecord])
      .select();

    if (error) throw error;

    await logAuditEvent('CREATE_RECORD', { recordId: data[0].id, title });
    return data[0];
  } catch (err) {
    showError("Failed to save record to cloud", err.message);
  }
}

async function updateRecord(id, updatedFields) {
  try {
    const updatePayload = {
      ...updatedFields,
      updated_by: currentUser.id
    };

    const { data, error } = await supabase
      .from('app_records')
      .update(updatePayload)
      .eq('id', id)
      .select();

    if (error) throw error;

    await logAuditEvent('UPDATE_RECORD', { recordId: id, updatedFields });
    return data[0];
  } catch (err) {
    showError("Failed to update cloud record", err.message);
  }
}

async function deleteRecord(id) {
  if (userRole !== 'ADMINISTRATOR') {
    showError("Unauthorized", "Only Administrators can delete records.");
    return;
  }

  try {
    const { error } = await supabase
      .from('app_records')
      .delete()
      .eq('id', id);

    if (error) throw error;

    await logAuditEvent('DELETE_RECORD', { recordId: id });
  } catch (err) {
    showError("Failed to delete cloud record", err.message);
  }
}

// 4. REAL-TIME MULTI-DEVICE SYNCHRONIZATION
function initRealtimeSync() {
  realtimeSubscription = supabase
    .channel('public:app_records')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'app_records' }, (payload) => {
      // Re-fetch or reactively update UI when external devices change records
      fetchRecords();
    })
    .subscribe();
}

// 5. AUDIT LOG ENGINE
async function logAuditEvent(action, details = {}) {
  if (!currentUser) return;
  await supabase.from('audit_logs').insert([{
    user_id: currentUser.id,
    user_email: currentUser.email,
    action,
    details
  }]);
}

// 6. ERROR HANDLING UTILITY
function showError(title, message) {
  const errorContainer = document.getElementById('error-banner') || alert;
  if (typeof errorContainer === 'function') {
    errorContainer(`${title}: ${message}`);
  } else {
    errorContainer.textContent = `${title}: ${message}`;
    errorContainer.style.display = 'block';
  }
}