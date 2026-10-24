import { getFreshIdToken } from './firebase';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

class ApiClient {
  constructor() {
    this.currentUser = JSON.parse(localStorage.getItem('debt_settle_user') || 'null');
    this.token = localStorage.getItem('debt_settle_token') || null;
    this.devUsername = localStorage.getItem('debt_settle_dev_username') || null;
  }

  setSession(user, token = null, devUsername = null) {
    this.currentUser = user;
    this.token = token;
    this.devUsername = devUsername;
    localStorage.setItem('debt_settle_user', JSON.stringify(user));
    if (token) localStorage.setItem('debt_settle_token', token);
    else localStorage.removeItem('debt_settle_token');
    if (devUsername) localStorage.setItem('debt_settle_dev_username', devUsername);
    else localStorage.removeItem('debt_settle_dev_username');
  }

  clearSession() {
    this.currentUser = null;
    this.token = null;
    this.devUsername = null;
    localStorage.removeItem('debt_settle_user');
    localStorage.removeItem('debt_settle_token');
    localStorage.removeItem('debt_settle_dev_username');
  }

  getHeaders() {
    const headers = {
      'Content-Type': 'application/json',
    };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    if (this.devUsername) {
      headers['X-Dev-Username'] = this.devUsername;
    }
    return headers;
  }

  async request(endpoint, options = {}, retried = false) {
    if (!this.devUsername && this.token) {
      try {
        const fresh = await getFreshIdToken();
        if (fresh && fresh !== this.token) {
          this.token = fresh;
          localStorage.setItem('debt_settle_token', fresh);
        }
      } catch {
        // Keep using the stored token if Firebase cannot refresh right now.
      }
    }

    const url = `${API_BASE_URL}${endpoint}`;
    const headers = { ...this.getHeaders(), ...(options.headers || {}) };
    const response = await fetch(url, { ...options, headers });
    
    if (!response.ok) {
      if (response.status === 401 && !retried && !this.devUsername) {
        const fresh = await getFreshIdToken(true);
        if (fresh) {
          this.token = fresh;
          localStorage.setItem('debt_settle_token', fresh);
          return this.request(endpoint, options, true);
        }
      }

      let errorMsg = `HTTP Error ${response.status}`;
      try {
        const errData = await response.json();
        errorMsg = errData.detail || errorMsg;
      } catch {
        // ignore json parse error
      }
      const err = new Error(errorMsg);
      err.status = response.status;
      throw err;
    }

    return response.json();
  }

  // Auth
  async signup(username, email, firebase_uid = null) {
    return this.request('/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ username, email, firebase_uid }),
    });
  }

  async getMe() {
    return this.request('/auth/me');
  }

  async updateUsername(username) {
    return this.request('/auth/me/username', {
      method: 'PATCH',
      body: JSON.stringify({ username }),
    });
  }

  async recordConsent(version = '1.0') {
    return this.request('/auth/me/consent', {
      method: 'POST',
      body: JSON.stringify({ version }),
    });
  }

  async deleteMyAccount() {
    return this.request('/auth/me', {
      method: 'DELETE',
    });
  }

  async updateMyMemberUpi(groupId, upi_id) {
    return this.request(`/groups/${groupId}/members/me`, {
      method: 'PATCH',
      body: JSON.stringify({ upi_id: upi_id || null }),
    });
  }

  async searchUsers(query) {
    return this.request(`/users/search?q=${encodeURIComponent(query)}`);
  }

  // Groups
  async listGroups() {
    return this.request('/groups');
  }

  async getGroup(id) {
    return this.request(`/groups/${id}`);
  }

  async renameGroup(groupId, name) {
    return this.request(`/groups/${groupId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    });
  }

  async markSeen(groupId, section) {
    return this.request(`/groups/${groupId}/seen`, {
      method: 'POST',
      body: JSON.stringify({ section }),
    });
  }

  async createGroup(name, admin_upi_id = null) {
    return this.request('/groups', {
      method: 'POST',
      body: JSON.stringify({ name, admin_upi_id }),
    });
  }

  async inviteMember(groupId, { method, email, username }) {
    return this.request(`/groups/${groupId}/invite`, {
      method: 'POST',
      body: JSON.stringify({ method, email, username }),
    });
  }

  async joinGroup(joinToken) {
    return this.request(`/groups/join/${joinToken}`, {
      method: 'POST',
    });
  }

  // Expenses & Debts
  async addEqualExpense(groupId, { description, total_amount, paid_by, split_among }) {
    return this.request(`/groups/${groupId}/expenses/equal`, {
      method: 'POST',
      body: JSON.stringify({ description, total_amount, paid_by, split_among }),
    });
  }

  async addGeneralExpense(groupId, { description, total_amount, split_type, paid_by, split_among }) {
    return this.request(`/groups/${groupId}/expenses`, {
      method: 'POST',
      body: JSON.stringify({ description, total_amount, split_type, paid_by, split_among }),
    });
  }

  async listExpenses(groupId) {
    return this.request(`/groups/${groupId}/expenses`);
  }

  async addDebt(groupId, { from_member_id, to_member_id, amount, note = '' }) {
    return this.request(`/groups/${groupId}/debts`, {
      method: 'POST',
      body: JSON.stringify({ from_member_id, to_member_id, amount, note }),
    });
  }

  // Balances
  async getBalances(groupId) {
    return this.request(`/groups/${groupId}/balances`);
  }

  // Settlement
  async settleGroup(groupId) {
    return this.request(`/groups/${groupId}/settle`, {
      method: 'POST',
    });
  }

  async getSettlements(groupId) {
    return this.request(`/groups/${groupId}/settlements`);
  }

  async markPaid(transactionId) {
    return this.request(`/settlements/${transactionId}/mark-paid`, {
      method: 'POST',
    });
  }

  async confirmPayment(transactionId) {
    return this.request(`/settlements/${transactionId}/confirm`, {
      method: 'POST',
    });
  }

  async denyPayment(transactionId) {
    return this.request(`/settlements/${transactionId}/deny`, {
      method: 'POST',
    });
  }

  async cancelSettlement(groupId) {
    return this.request(`/groups/${groupId}/cancel-settlement`, {
      method: 'POST',
    });
  }

  // Chat
  async listMessages(groupId) {
    return this.request(`/groups/${groupId}/chat`);
  }

  async sendMessage(groupId, body, replyToId = null) {
    return this.request(`/groups/${groupId}/chat`, {
      method: 'POST',
      body: JSON.stringify({
        body,
        ...(replyToId !== null ? { reply_to_id: replyToId } : {}),
      }),
    });
  }

  async markChatRead(groupId) {
    return this.request(`/groups/${groupId}/chat/read`, {
      method: 'POST',
    });
  }
}

export const api = new ApiClient();
