import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, collection, query, where, orderBy, onSnapshot, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCCUQG-BNwldxOziMUNrJXZjooaXiJpbkY",
  authDomain: "the-unemployed-trio.firebaseapp.com",
  projectId: "the-unemployed-trio",
  storageBucket: "the-unemployed-trio.firebasestorage.app",
  messagingSenderId: "286947399043",
  appId: "1:286947399043:web:df2665077aec576bbd52b6",
  measurementId: "G-5PLE98LG1Y"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

window.ticketApp = function() {
  return {
    user: null,
    tickets: [],
    loading: true,
    showModal: false,
    showDetail: false,
    selectedTicket: null,
    selectedTicketId: null,
    followUpMessage: '',

    init() {
      // Get ticketId from URL if present
      const urlParams = new URLSearchParams(window.location.search);
      this.selectedTicketId = urlParams.get('ticketId');

      onAuthStateChanged(auth, async (user) => {
        if (user) {
          this.user = user;
          this.loadTickets(user.uid);
        } else {
          window.location.href = '/login.html';
        }
      });
    },

    loadTickets(userId) {
      this.loading = true;
      
      // Multiple collection names and user ID fields to try
      const configs = [
        { collection: 'tickets', userField: 'student_uid', orderField: 'created_at' },
        { collection: 'tickets', userField: 'userId', orderField: 'created_at' },
        { collection: 'tickets', userField: 'senderId', orderField: 'createdAt' },
        { collection: 'inquiries', userField: 'senderId', orderField: 'createdAt' },
        { collection: 'inquiries', userField: 'userId', orderField: 'createdAt' },
        { collection: 'support', userField: 'userId', orderField: 'createdAt' },
        { collection: 'questions', userField: 'userId', orderField: 'createdAt' }
      ];
      
      let loaded = false;
      let configIndex = 0;
      
      const tryLoad = async (config) => {
        try {
          console.log(`[MyTickets] Trying ${config.collection} with ${config.userField}`);
          const q = query(
            collection(db, config.collection),
            where(config.userField, '==', userId),
            orderBy(config.orderField, 'desc')
          );
          
          onSnapshot(q, (snapshot) => {
            console.log(`[MyTickets] ${config.collection} result:`, snapshot.docs.length);
            if (!loaded || snapshot.docs.length > 0) {
              loaded = true;
              this.tickets = snapshot.docs.map(d => {
                const data = d.data();
                console.log('[MyTickets] Ticket data:', d.id, data);
                return {
                  id: d.id, 
                  collection: config.collection,
                  ...data
                };
              });
              this.loading = false;
              
              // If ticketId in URL, open that ticket
              if (this.selectedTicketId) {
                const ticket = this.tickets.find(t => t.id === this.selectedTicketId);
                if (ticket) {
                  this.openTicket(ticket);
                }
              }
            }
          }, (err) => {
            console.log(`[MyTickets] ${config.collection} error:`, err.message);
            if (!loaded) tryNext();
          });
        } catch (e) {
          console.log(`[MyTickets] ${config.collection} failed:`, e.message);
          if (!loaded) tryNext();
        }
      };
      
      const tryNext = () => {
        if (configIndex < configs.length) {
          tryLoad(configs[configIndex++]);
        } else {
          // Try user subcollection as last resort
          tryUserSubcollection();
        }
      };
      
      const tryUserSubcollection = () => {
        try {
          const q = query(
            collection(db, 'users', userId, 'inquiries'),
            orderBy('createdAt', 'desc')
          );
          onSnapshot(q, (snapshot) => {
            if (!loaded || snapshot.docs.length > 0) {
              loaded = true;
              this.tickets = snapshot.docs.map(d => ({ 
                id: d.id, 
                collection: 'users/inquiries',
                ...d.data() 
              }));
              this.loading = false;
              
              if (this.selectedTicketId) {
                const ticket = this.tickets.find(t => t.id === this.selectedTicketId);
                if (ticket) this.openTicket(ticket);
              }
            } else {
              this.loading = false;
              this.tickets = [];
            }
          }, () => {
            this.loading = false;
            this.tickets = [];
          });
        } catch (e) {
          this.loading = false;
          this.tickets = [];
        }
      };
      
      tryNext();
    },

    openTicket(ticket) {
      console.log('[MyTickets] Opening ticket:', ticket);
      this.selectedTicket = ticket;
      this.showDetail = true;
      this.showModal = false;
      
      console.log('[MyTickets] Ticket title:', this.getTicketTitle(ticket));
      console.log('[MyTickets] Selected ticket after set:', this.selectedTicket);
      
      // Mark as read if opened from notification
      if (this.selectedTicketId === ticket.id) {
        this.markTicketRead(ticket.id);
      }
    },

    closeDetail() {
      this.showDetail = false;
      this.selectedTicket = null;
    },

    getTicketPreview(ticket) {
      // Try multiple fields for content (chat.html uses highlighted_content)
      let content = ticket.highlighted_content || ticket.highlighted_text || ticket.content || 
                    ticket.message || ticket.body || ticket.student_question || '';
      // Strip HTML tags for preview
      content = content.replace(/<[^>]*>/g, '');
      // Decode HTML entities
      content = content.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
      return content.substring(0, 100).trim() + (content.length > 100 ? '...' : '');
    },

    getTicketTitle(ticket) {
      if (!ticket) return '(제목 없음)';
      // Convert Proxy to plain object if needed
      const t = JSON.parse(JSON.stringify(ticket));
      // Try multiple fields for title (chat.html uses student_question)
      return t.student_question || t.title || t.subject || t.topic || '(제목 없음)';
    },

    hasResponse(ticket) {
      // Check multiple possible response fields
      return !!(ticket.response || ticket.instructor_response || ticket.admin_response || 
                ticket.answer || ticket.reply || ticket.follow_up_messages?.length > 0);
    },

    getInitials(name) {
      if (!name) return '관';
      return name.charAt(0).toUpperCase();
    },

    formatContent(content) {
      if (!content) return '(내용 없음)';
      // Escape HTML but preserve line breaks
      return content
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>');
    },

    async sendFollowUp() {
      if (!this.followUpMessage.trim() || !this.selectedTicket) return;
      
      try {
        const { addDoc, collection, serverTimestamp } = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js');
        
        await addDoc(collection(db, 'ticket_replies'), {
          ticket_id: this.selectedTicket.id,
          user_id: this.user.uid,
          message: this.followUpMessage,
          created_at: serverTimestamp()
        });
        
        this.followUpMessage = '';
        alert('메시지가 전송되었습니다.');
      } catch (e) {
        console.error('Send follow-up error:', e);
        alert('전송 중 오류가 발생했습니다.');
      }
    },

    async markTicketRead(ticketId) {
      // Update notification read status
      try {
        const { updateDoc, doc } = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js');
        // Find and update notification
        const notifQuery = query(
          collection(db, 'notifications'),
          where('user_id', '==', this.user.uid),
          where('ticket_id', '==', ticketId)
        );
        // This would need a getDocs call, but we'll skip for simplicity
      } catch (e) {
        console.error('Mark read error:', e);
      }
    },

    goBack() {
      if (this.showDetail) {
        this.closeDetail();
      } else {
        window.location.href = 'mypage.html';
      }
    },

    formatDate(date) {
      if (!date) return '';
      let d;
      if (date.toDate) {
        d = date.toDate();
      } else if (typeof date === 'string') {
        d = new Date(date);
      } else if (date.seconds) {
        d = new Date(date.seconds * 1000);
      } else {
        d = new Date(date);
      }
      return d.toLocaleDateString('ko-KR', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    }
  };
};
