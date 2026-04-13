/**
 * Contact/Inquiry Page JavaScript
 * Uses global window.db and window.auth from module loader
 */

// Helper functions for Firestore
const _db = () => window.db;
const _auth = () => window.auth;

window.contactApp = function() {
  return {
    // User state
    user: null,
    userRole: 'student',
    userInitials: 'U',
    photoURL: null,
    
    // UI state
    showNotifications: false,
    showProfileDropdown: false,
    notifications: [],
    unreadCount: 0,
    isSubmitting: false,
    
    // Inquiry form
    inquiryType: 'admin',
    selectedInstructor: '',
    inquiryTitle: '',
    inquiryContent: '',
    instructors: [],
    attachmentFile: null,
    attachmentUrl: null,
    isUploading: false,
    
    // Inquiry history
    myInquiries: [],
    
    init() {
      console.log('[Contact] Initializing...');
      
      // Check if Firebase is loaded
      if (!window.auth || !window.db) {
        console.error('[Contact] Firebase not loaded');
        setTimeout(() => this.init(), 500);
        return;
      }
      
      // Check auth state
      window.auth.onAuthStateChanged(async (user) => {
        if (user) {
          this.user = user;
          this.userInitials = this.getInitials(user.displayName || user.email);
          
          // Load profile photo from userProfiles
          try {
            const profileDoc = await window.db.collection('userProfiles').doc(user.uid).get();
            if (profileDoc.exists) {
              this.photoURL = profileDoc.data().photoURL || null;
            }
          } catch (e) {
            console.error('[Contact] Profile photo load error:', e);
          }
          
          this.loadNotifications();
          this.loadInstructors();
          this.loadMyInquiries();
        } else {
          window.location.href = 'index.html';
        }
      });
    },
    
    loadUserRole(uid) {
      try {
        window.db.collection('users').doc(uid).get().then(userDoc => {
          if (userDoc.exists) {
            this.userRole = userDoc.data().role || 'student';
          }
        });
      } catch (e) {
        console.error('[Contact] Error loading user role:', e);
      }
    },
    
    async loadInstructors() {
      try {
        const snapshot = await window.db.collection('users')
          .where('role', 'in', ['instructor', 'staff'])
          .get();
        
        this.instructors = snapshot.docs.map(doc => ({
          id: doc.id,
          name: doc.data().displayName || doc.data().name || '이름 없음',
          email: doc.data().email || ''
        }));
      } catch (error) {
        console.error('[Contact] Error loading instructors:', error);
        this.instructors = [];
      }
    },
    
    loadMyInquiries() {
      try {
        window.db.collection('inquiries')
          .where('senderId', '==', this.user.uid)
          .orderBy('createdAt', 'desc')
          .onSnapshot((snapshot) => {
            this.myInquiries = snapshot.docs.map(doc => ({
              id: doc.id,
              ...doc.data()
            }));
          });
      } catch (error) {
        console.error('[Contact] Error loading inquiries:', error);
      }
    },

    loadNotifications() {
      try {
        window.db.collection('notifications')
          .where('user_id', '==', this.user.uid)
          .where('read', '==', false)
          .orderBy('created_at', 'desc')
          .onSnapshot((snapshot) => {
            this.notifications = snapshot.docs.map(doc => ({
              id: doc.id,
              ...doc.data()
            }));
            this.unreadCount = this.notifications.length;
          });
      } catch (error) {
        console.error('[Contact] Error loading notifications:', error);
      }
    },

    async markNotificationRead(notificationId) {
      try {
        await window.db.collection('notifications').doc(notificationId).update({
          read: true,
          updated_at: firebase.firestore.FieldValue.serverTimestamp()
        });
      } catch (error) {
        console.error('[Contact] Error marking notification read:', error);
      }
    },

    resolveNotificationUrl(notification) {
      const courseId = notification.courseId || notification.course_id;
      const postId = notification.postId || notification.post_id;
      const postType = notification.postType || notification.post_type || 'post';
      const ticketId = notification.ticketId || notification.ticket_id;

      if (postId) {
        return `community-post.html?id=${postId}&type=${postType}`;
      }
      if (ticketId) {
        return `my-tickets.html?ticketId=${ticketId}`;
      }
      if (courseId) {
        return `classroom.html?courseId=${courseId}`;
      }
      if (notification.link) {
        return notification.link;
      }
      return null;
    },

    async handleNotification(notification) {
      await this.markNotificationRead(notification.id);
      this.showNotifications = false;
      this.notifications = this.notifications.filter(n => n.id !== notification.id);
      this.unreadCount = this.notifications.length;

      const targetUrl = this.resolveNotificationUrl(notification);
      if (targetUrl) {
        window.location.href = targetUrl;
      }
    },

    async markAllNotificationsRead() {
      try {
        const batch = window.db.batch();
        this.notifications.forEach(notification => {
          const ref = window.db.collection('notifications').doc(notification.id);
          batch.update(ref, {
            read: true,
            updated_at: firebase.firestore.FieldValue.serverTimestamp()
          });
        });
        await batch.commit();
        this.notifications = [];
        this.unreadCount = 0;
      } catch (error) {
        console.error('[Contact] Error marking all notifications read:', error);
      }
    },

    async deleteNotification(notification) {
      await this.markNotificationRead(notification.id);
      this.notifications = this.notifications.filter(n => n.id !== notification.id);
      this.unreadCount = this.notifications.length;
    },
    
    async submitInquiry() {
      if (!this.inquiryTitle.trim()) {
        Swal.fire({ icon: 'warning', title: '제목을 입력해주세요', confirmButtonColor: '#2563eb' });
        return;
      }
      
      if (!this.inquiryContent.trim()) {
        Swal.fire({ icon: 'warning', title: '내용을 입력해주세요', confirmButtonColor: '#2563eb' });
        return;
      }
      
      if (this.inquiryType === 'instructor' && !this.selectedInstructor) {
        Swal.fire({ icon: 'warning', title: '강사를 선택해주세요', confirmButtonColor: '#2563eb' });
        return;
      }
      
      this.isSubmitting = true;
      
      try {
        let recipientName = '관리자';
        let recipientId = null;
        
        if (this.inquiryType === 'instructor') {
          const instructor = this.instructors.find(i => i.id === this.selectedInstructor);
          if (instructor) {
            recipientName = instructor.name;
            recipientId = instructor.id;
          }
        }
        
        // Upload attachment if exists
        let attachmentUrl = null;
        let attachmentName = null;
        if (this.attachmentFile) {
          attachmentUrl = await this.uploadAttachment();
          if (attachmentUrl) {
            attachmentName = this.attachmentFile.name;
          }
        }
        
        // Create inquiry
        const inquiryData = {
          title: this.inquiryTitle.trim(),
          content: this.inquiryContent.trim(),
          recipientType: this.inquiryType,
          recipientId: recipientId,
          recipientName: recipientName,
          senderId: this.user.uid,
          senderName: this.user.displayName || this.user.email.split('@')[0],
          senderEmail: this.user.email,
          status: 'pending',
          responseCount: 0,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        
        // Add attachment info if exists
        if (attachmentUrl) {
          inquiryData.attachmentUrl = attachmentUrl;
          inquiryData.attachmentName = attachmentName;
        }
        
        const inquiryRef = await window.db.collection('inquiries').add(inquiryData);
        
        // Create notification for recipient (instructor or admin)
        const notificationData = {
          user_id: recipientId || 'admin', // If no recipient, notify admin
          title: '새 문의가 도착했습니다',
          message: `'${this.inquiryTitle.trim()}' 문의가 접수되었습니다.`,
          type: 'inquiry',
          read: false,
          created_at: firebase.firestore.FieldValue.serverTimestamp(),
          inquiryId: inquiryRef.id,
          link: 'instructor.html'
        };
        await window.db.collection('notifications').add(notificationData);
        
        this.inquiryTitle = '';
        this.inquiryContent = '';
        this.selectedInstructor = '';
        this.attachmentFile = null;
        this.attachmentUrl = null;
        
        Swal.fire({
          icon: 'success',
          title: '문의가 접수되었습니다',
          text: '답변은 문의 내역에서 확인하실 수 있습니다',
          confirmButtonColor: '#2563eb'
        });
      } catch (error) {
        console.error('[Contact] Error:', error);
        Swal.fire({ icon: 'error', title: '문의 접수 실패', text: '다시 시도해주세요', confirmButtonColor: '#2563eb' });
      } finally {
        this.isSubmitting = false;
      }
    },
    
    logout() {
      window.auth.signOut().then(() => {
        window.location.href = 'index.html';
      });
    },
    
    formatDate(timestamp) {
      if (!timestamp) return '';
      try {
        let date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        return date.toLocaleDateString('ko-KR', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });
      } catch (e) {
        return '';
      }
    },

    getInquiryStatusText(status) {
      const statusMap = {
        pending: '대기중',
        answered: '답변완료',
        responded: '답변완료',
        closed: '해결 됨'
      };
      return statusMap[status] || '대기중';
    },

    getInquiryStatusClass(status) {
      if (status === 'answered' || status === 'responded') return 'status-answered';
      if (status === 'closed') return 'status-closed';
      return 'status-pending';
    },
    
    getInitials(name) {
      if (!name) return 'U';
      return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    },
    
    // File attachment handlers
    handleFileSelect(event) {
      const file = event.target.files[0];
      if (!file) return;
      
      // Validate file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        Swal.fire({
          icon: 'error',
          title: '파일 크기 초과',
          text: '최대 5MB까지 업로드 가능합니다.',
          confirmButtonColor: '#2563eb'
        });
        return;
      }
      
      // Validate file type
      const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
      if (!allowedTypes.includes(file.type)) {
        Swal.fire({
          icon: 'error',
          title: '지원하지 않는 파일 형식',
          text: 'JPG, PNG, PDF, DOC 파일만 업로드 가능합니다.',
          confirmButtonColor: '#2563eb'
        });
        return;
      }
      
      this.attachmentFile = file;
    },
    
    removeAttachment() {
      this.attachmentFile = null;
      this.attachmentUrl = null;
    },
    
    async uploadAttachment() {
      if (!this.attachmentFile) return null;
      
      this.isUploading = true;
      
      try {
        const storageRef = window.storage.ref();
        const fileRef = storageRef.child(`inquiry_attachments/${Date.now()}_${this.attachmentFile.name}`);
        
        await fileRef.put(this.attachmentFile);
        const url = await fileRef.getDownloadURL();
        
        this.attachmentUrl = url;
        return url;
      } catch (error) {
        console.error('Error uploading attachment:', error);
        Swal.fire({
          icon: 'error',
          title: '업로드 실패',
          text: '파일 업로드 중 오류가 발생했습니다.',
          confirmButtonColor: '#2563eb'
        });
        return null;
      } finally {
        this.isUploading = false;
      }
    }
  };
};
