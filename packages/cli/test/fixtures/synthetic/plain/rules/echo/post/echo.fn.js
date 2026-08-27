function handler({ request }) { return { text: String((request.body || {}).text || '') } }
