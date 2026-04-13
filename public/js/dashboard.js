window._fbDash = import('./firebase-init.js?v=4');

window.dashboardApp = function() {
  return {
    user: null,
    userInitials: '',
    photoURL: null,
    recentChats: [],
    stats: { totalChats: 0, totalTickets: 0, weeklyChats: 0 },
    
    // Notifications
    notifications: [],
    unreadCount: 0,
    showNotifications: false,
    notificationLegacyItems: [],
    notificationRecipientItems: [],
    notificationUnsubscribes: [],

    // Settings
    theme: localStorage.getItem('tb_theme') || 'light',
    language: localStorage.getItem('tb_language') || 'ko',
    notificationsEnabled: localStorage.getItem('tb_notifications') !== 'off',
    showChatSettingsModal: false,

    // Profile
    showProfileModal: false,
    showProfileDropdown: false,
    editingProfile: false,
    profileForm: { displayName: '' },

    // Course Notices
    courseNotices: [],

    // Admin Announcements
    adminAnnouncements: [],
    announcementPage: 1,
    announcementsPerPage: 4,

    // Instructor Tickets Pagination
    ticketPage: 1,
    ticketsPerPage: 4,

    // My Tickets
    myTickets: [],

    // Enrolled Courses
    enrolledCourses: [],
    enrolledPage: 1,
    enrolledPerPage: 3,
    
    // Recent Chats
    recentChats: [],
    chatPage: 1,
    chatsPerPage: 3,
    
    // Instructor Certificate Upload
    certificateFile: null,
    certificatePreview: null,
    isSubmittingCertificate: false,
    
    // Courses
    approvedCourses: [],
    myEnrollments: [],
    selectedCourse: null,
    showCourseDetailModal: false,
    isApplying: false,
    courseSearchQuery: '',
    appliedSearchQuery: '',
    courseSearchType: 'title',
    currentPage: 1,
    itemsPerPage: 4,
    
    async init() {
      const fb = await _fbDash;
      
      fb.onAuthStateChanged(fb.auth, async (user) => {
        if (!user) {
          window.location.href = 'login.html';
          return;
        }
        
        // Load user data including certificate status
        const userDoc = await fb.getDoc(fb.doc(fb.db, 'users', user.uid));
        if (userDoc.exists()) {
          const userData = userDoc.data();
          if (userData.certificateUrl) {
            this.certificatePreview = userData.certificateUrl;
          }
        }
        
        // role 확인 - 강사와 admin은 instructor.html로 리다이렉트
        try {
          const userDoc = await fb.getDoc(fb.doc(fb.db, 'users', user.uid));
          if (userDoc.exists()) {
            const userData = userDoc.data();
            if (['instructor', 'admin', 'staff'].includes(userData.role)) {
              window.location.href = 'instructor.html';
              return;
            }
          }
        } catch (e) {
          console.error('Role check error:', e);
        }
        
        this.user = { uid: user.uid, email: user.email, displayName: user.displayName || user.email?.split('@')[0] || '사용자' };
        this.userInitials = (user.displayName || user.email || '?').charAt(0).toUpperCase();
        
        // Load user profile photo
        const profileDoc = await fb.getDoc(fb.doc(fb.db, 'userProfiles', user.uid));
        if (profileDoc.exists()) {
          this.photoURL = profileDoc.data().photoURL || null;
        }
        
        this.greeting = this.getGreeting();
        
        // Load recent chats
        const chatsQ = fb.query(
          fb.collection(fb.db, 'chat_sessions'),
          fb.where('user_id', '==', user.uid),
          fb.orderBy('updated_at', 'desc'),
          fb.limit(6)
        );
        
        fb.onSnapshot(chatsQ, (snap) => {
          this.recentChats = snap.docs.map(d => {
            const data = d.data();
            const messages = data.messages || [];
            return {
              id: d.id,
              ...data,
              message_count: messages.length
            };
          });
          this.stats.totalChats = snap.size;
          
          // Weekly chats count
          const weekAgo = new Date();
          weekAgo.setDate(weekAgo.getDate() - 7);
          this.stats.weeklyChats = this.recentChats.filter(c => {
            const d = c.updated_at?.toDate?.() || new Date(0);
            return d > weekAgo;
          }).length;
        });
        
        // Load tickets count
        const ticketsQ = fb.query(
          fb.collection(fb.db, 'tickets'),
          fb.where('student_uid', '==', user.uid)
        );
        fb.getDocs(ticketsQ).then(snap => {
          this.stats.totalTickets = snap.size;
        });
        
        // Load notifications
        this.loadNotifications(fb, user.uid);
        
        // Load approved courses
        this.loadCourses(fb, user.uid);

        // Load enrolled courses
        this.loadEnrolledCourses(fb, user.uid);
        
        // Load admin announcements
        this.loadAdminAnnouncements(fb);

        // Load my tickets
        this.loadMyTickets(fb, user.uid);
      });
    },
    
    // My Tickets
    loadMyTickets(fb, userId) {
      const q = fb.query(
        fb.collection(fb.db, 'tickets'),
        fb.where('student_uid', '==', userId),
        fb.orderBy('created_at', 'desc'),
        fb.limit(10)
      );
      fb.onSnapshot(q, (snap) => {
        this.myTickets = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        this.stats.totalTickets = this.myTickets.length;
      });
    },

    formatDate(timestamp) {
      if (!timestamp) return '';
      const d = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
      return (d.getMonth()+1) + '/' + d.getDate();
    },

    openTicketDetail(ticket) {
      window.location.href = 'chat.html';
    },

    // Notifications
    async loadNotifications(fb, userId) {
      this.notificationUnsubscribes.forEach((unsubscribe) => unsubscribe?.());
      this.notificationUnsubscribes = [];
      this.notificationLegacyItems = [];
      this.notificationRecipientItems = [];

      const subscribeByField = (fieldName, targetKey) => {
        const notifQ = fb.query(
          fb.collection(fb.db, 'notifications'),
          fb.where(fieldName, '==', userId),
          fb.where('read', '==', false),
          fb.orderBy('created_at', 'desc'),
          fb.limit(20)
        );
        const unsubscribe = fb.onSnapshot(notifQ, (snap) => {
          this[targetKey] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          this.mergeNotifications();
        }, (err) => {
          console.warn(`Notifications load error (${fieldName}):`, err);
          this[targetKey] = [];
          this.mergeNotifications();
        });
        this.notificationUnsubscribes.push(unsubscribe);
      };

      subscribeByField('user_id', 'notificationLegacyItems');
      subscribeByField('recipientId', 'notificationRecipientItems');
    },

    mergeNotifications() {
      const merged = [...this.notificationLegacyItems, ...this.notificationRecipientItems];
      const deduped = Array.from(new Map(merged.map(item => [item.id, item])).values());
      deduped.sort((a, b) => this.getNotificationTimestamp(b) - this.getNotificationTimestamp(a));
      this.notifications = deduped;
      this.unreadCount = deduped.length;
    },

    getNotificationTimestamp(notification) {
      const value = notification?.created_at || notification?.createdAt;
      if (!value) return 0;
      if (typeof value.toMillis === 'function') return value.toMillis();
      if (typeof value.seconds === 'number') return value.seconds * 1000;
      return new Date(value).getTime() || 0;
    },

    resolveNotificationUrl(notification) {
      const courseId = notification.courseId || notification.course_id;
      const lessonId = notification.lessonId || notification.lesson_id;
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
        return lessonId
          ? `classroom.html?courseId=${courseId}&lessonId=${lessonId}`
          : `classroom.html?courseId=${courseId}`;
      }

      if (notification.link) {
        return notification.link;
      }

      return null;
    },
    
    async markNotificationRead(fb, notificationId) {
      await fb.updateDoc(fb.doc(fb.db, 'notifications', notificationId), {
        read: true,
        updated_at: fb.serverTimestamp()
      });
    },

    async handleNotificationClick(notification) {
      const fb = await window._fbDash;
      
      await this.markNotificationRead(fb, notification.id);
      this.showNotifications = false;
      
      this.notifications = this.notifications.filter(n => n.id !== notification.id);
      this.unreadCount = this.notifications.length;

      this.notificationLegacyItems = this.notificationLegacyItems.filter(n => n.id !== notification.id);
      this.notificationRecipientItems = this.notificationRecipientItems.filter(n => n.id !== notification.id);

      const targetUrl = this.resolveNotificationUrl(notification);
      if (targetUrl) {
        window.location.href = targetUrl;
      }
    },

    async handleNotification(notification) {
      await this.handleNotificationClick(notification);
    },
    
    // Settings
    applyTheme(theme) {
      this.theme = theme;
      localStorage.setItem('tb_theme', theme);
      document.documentElement.setAttribute('data-theme', theme);
    },
    
    setLanguage(lang) {
      this.language = lang;
      localStorage.setItem('tb_language', lang);
    },
    
    toggleNotifications(enabled) {
      this.notificationsEnabled = enabled;
      localStorage.setItem('tb_notifications', enabled ? 'on' : 'off');
    },
    
    // Profile
    async saveProfile() {
      try {
        const fb = await _fbDash;
        const user = fb.auth.currentUser;
        if (user && this.profileForm.displayName) {
          await fb.updateProfile(user, { displayName: this.profileForm.displayName });
          await fb.updateDoc(fb.doc(fb.db, 'users', user.uid), {
            displayName: this.profileForm.displayName,
            updated_at: fb.serverTimestamp()
          });
          this.user.displayName = this.profileForm.displayName;
          this.userInitials = this.profileForm.displayName.charAt(0).toUpperCase();
          this.editingProfile = false;
          Swal.fire({ icon: 'success', title: '프로필 수정 완료', timer: 1500, showConfirmButton: false });
        }
      } catch (e) {
        console.error('Profile update error:', e);
        Swal.fire({ icon: 'error', title: '수정 실패', text: '다시 시도해주세요.', confirmButtonColor: '#2563eb' });
      }
    },
    
    handleCertificateUpload(event) {
      const file = event.target.files[0];
      if (!file) return;
      
      if (!file.type.startsWith('image/')) {
        Swal.fire({
          icon: 'error',
          title: '잘못된 파일 형식',
          text: '이미지 파일(JPG, PNG)만 업로드 가능합니다.',
          confirmButtonColor: '#2563eb'
        });
        return;
      }
      
      if (file.size > 40 * 1024 * 1024) {
        Swal.fire({
          icon: 'error',
          title: '파일 크기 초과',
          text: '파일 크기는 40MB 이하여야 합니다.',
          confirmButtonColor: '#2563eb'
        });
        return;
      }
      
      this.certificateFile = file;
      
      const reader = new FileReader();
      reader.onload = (e) => {
        this.certificatePreview = e.target.result;
      };
      reader.readAsDataURL(file);
    },
    
    async submitInstructorRequest() {
      if (!this.certificateFile) {
        Swal.fire({
          icon: 'warning',
          title: '파일 필요',
          text: '강사증 이미지를 먼저 업로드해주세요.',
          confirmButtonColor: '#2563eb'
        });
        return;
      }
      
      this.isSubmittingCertificate = true;
      
      try {
        const fb = await _fbDash;
        const user = fb.auth.currentUser;
        
        if (!user) {
          throw new Error('로그인이 필요합니다.');
        }
        
        const storageRef = fb.ref(fb.storage, `certificates/${user.uid}/${Date.now()}_${this.certificateFile.name}`);
        await fb.uploadBytes(storageRef, this.certificateFile);
        const certificateUrl = await fb.getDownloadURL(storageRef);
        
        await fb.updateDoc(fb.doc(fb.db, 'users', user.uid), {
          certificateUrl: certificateUrl,
          certificateUploadedAt: fb.serverTimestamp(),
          certificateStatus: 'pending',
          roleUpgradeRequested: true,
          requestedRole: 'instructor',
          updated_at: fb.serverTimestamp()
        });
        
        await fb.addDoc(fb.collection(fb.db, 'adminNotifications'), {
          type: 'instructor_upgrade_request',
          userId: user.uid,
          userEmail: user.email,
          userName: this.user?.displayName || user.email,
          certificateUrl: certificateUrl,
          status: 'pending',
          createdAt: fb.serverTimestamp(),
          read: false
        });
        
        Swal.fire({
          icon: 'success',
          title: '강사 인증 요청 완료',
          text: '강사증이 업로드되었습니다. 관리자 승인 후 강사 권한이 부여됩니다.',
          confirmButtonColor: '#2563eb'
        });
      } catch (error) {
        console.error('Certificate upload error:', error);
        Swal.fire({
          icon: 'error',
          title: '업로드 실패',
          text: '강사증 업로드 중 오류가 발생했습니다.',
          confirmButtonColor: '#2563eb'
        });
      } finally {
        this.isSubmittingCertificate = false;
      }
    },
    
    async doLogout() {
      const fb = await _fbDash;
      await fb.signOut(fb.auth);
      window.location.href = 'login.html';
    },
    
    goToChat(chatId) {
      window.location.href = 'chat.html?chat=' + chatId;
    },
    
    startNewChat() {
      window.location.href = 'chat.html?new=1';
    },
    
    getGradient(id) {
      const gradients = [
        'linear-gradient(135deg, #dbeafe, #bfdbfe)',
        'linear-gradient(135deg, #fef3c7, #fde68a)',
        'linear-gradient(135deg, #d1fae5, #a7f3d0)',
        'linear-gradient(135deg, #fce7f3, #fbcfe8)',
        'linear-gradient(135deg, #e0e7ff, #c7d2fe)',
        'linear-gradient(135deg, #fed7d7, #fecaca)'
      ];
      const idx = id ? id.charCodeAt(0) % gradients.length : 0;
      return gradients[idx];
    },
    
    formatDate(ts) {
      if (!ts) return '';
      const d = ts.toDate ? ts.toDate() : new Date(ts);
      const now = new Date();
      const diff = now - d;
      if (diff < 60000) return '방금 전';
      if (diff < 3600000) return Math.floor(diff / 60000) + '분 전';
      if (diff < 86400000) return Math.floor(diff / 3600000) + '시간 전';
      return d.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', year: 'numeric' });
    },
    
    // Courses Methods
    async loadCourses(fb, userId) {
      const coursesQ = fb.query(
        fb.collection(fb.db, 'courseRequests'),
        fb.where('status', '==', 'approved')
      );
      
      fb.onSnapshot(coursesQ, async (snap) => {
        const courses = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        
        for (const course of courses) {
          const enrollQ = fb.query(
            fb.collection(fb.db, 'courseEnrollments'),
            fb.where('courseId', '==', course.id),
            fb.where('status', 'in', ['pending', 'approved'])
          );
          const enrollSnap = await fb.getDocs(enrollQ);
          course.enrolledCount = enrollSnap.size;
        }
        
        this.approvedCourses = courses;
      });
      
      const myEnrollQ = fb.query(
        fb.collection(fb.db, 'courseEnrollments'),
        fb.where('studentId', '==', userId)
      );
      
      fb.onSnapshot(myEnrollQ, (snap) => {
        this.myEnrollments = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      });
    },
    
    // Search and Pagination Getters
    get filteredCourses() {
      let result = this.approvedCourses;
      
      if (this.appliedSearchQuery) {
        const query = this.appliedSearchQuery.toLowerCase();
        if (this.courseSearchType === 'title') {
          result = result.filter(c => c.title?.toLowerCase().includes(query));
        } else if (this.courseSearchType === 'instructor') {
          result = result.filter(c => c.instructorName?.toLowerCase().includes(query));
        }
      }
      
      return result;
    },
    
    get paginatedCourses() {
      const start = (this.currentPage - 1) * this.itemsPerPage;
      const end = start + this.itemsPerPage;
      return this.filteredCourses.slice(start, end);
    },
    
    get emptySlots() {
      const count = this.paginatedCourses.length;
      return count < this.itemsPerPage ? this.itemsPerPage - count : 0;
    },
    
    get totalPages() {
      return Math.ceil(this.filteredCourses.length / this.itemsPerPage);
    },
    
    get visiblePages() {
      const pages = [];
      const maxVisible = 10;
      let start = Math.max(1, this.currentPage - Math.floor(maxVisible / 2));
      let end = Math.min(this.totalPages, start + maxVisible - 1);
      
      if (end - start < maxVisible - 1) {
        start = Math.max(1, end - maxVisible + 1);
      }
      
      for (let i = start; i <= end; i++) {
        pages.push(i);
      }
      return pages;
    },
    
    get topCourses() {
      return [...this.approvedCourses]
        .sort((a, b) => (b.enrolledCount || 0) - (a.enrolledCount || 0))
        .slice(0, 3);
    },
    
    // Search Actions
    applyCourseSearch() {
      this.appliedSearchQuery = this.courseSearchQuery;
      this.currentPage = 1;
    },
    
    clearCourseSearch() {
      this.courseSearchQuery = '';
      this.appliedSearchQuery = '';
      this.currentPage = 1;
    },
    
    // Course Detail Actions
    openCourseDetail(course) {
      const enrollment = this.myEnrollments.find(e => e.courseId === course.id);
      course.isEnrolled = !!enrollment;
      course.enrollmentStatus = enrollment?.status;
      
      this.selectedCourse = course;
      this.showCourseDetailModal = true;
    },
    
    closeCourseDetail() {
      this.showCourseDetailModal = false;
      this.selectedCourse = null;
      this.isApplying = false;
    },
    
    // Enrollment Action
    async applyForCourse() {
      if (!this.selectedCourse || !this.user) return;
      
      this.isApplying = true;
      
      try {
        const fb = await _fbDash;
        
        const existingQ = fb.query(
          fb.collection(fb.db, 'courseEnrollments'),
          fb.where('courseId', '==', this.selectedCourse.id),
          fb.where('studentId', '==', this.user.uid)
        );
        const existingSnap = await fb.getDocs(existingQ);
        
        if (!existingSnap.empty) {
          Swal.fire({
            icon: 'info',
            title: '이미 신청하셨습니다',
            text: '이 강의에 이미 수강 신청하셨습니다.',
            confirmButtonColor: '#2563eb'
          });
          this.isApplying = false;
          return;
        }
        
        const enrollmentData = {
          courseId: this.selectedCourse.id,
          courseTitle: this.selectedCourse.title,
          studentId: this.user.uid,
          studentName: this.user.displayName,
          studentEmail: this.user.email,
          status: 'pending',
          appliedAt: fb.serverTimestamp()
        };
        
        const enrollmentRef = await fb.addDoc(fb.collection(fb.db, 'courseEnrollments'), enrollmentData);
        
        const notificationData = {
          user_id: this.selectedCourse.instructorId,
          recipientId: this.selectedCourse.instructorId,
          type: 'new_enrollment',
          title: '새 수강 신청',
          message: `${this.user.displayName} 학생이 "${this.selectedCourse.title}" 강의에 수강 신청했습니다.`,
          read: false,
          created_at: fb.serverTimestamp(),
          courseId: this.selectedCourse.id,
          courseTitle: this.selectedCourse.title,
          studentId: this.user.uid,
          studentName: this.user.displayName,
          enrollmentId: enrollmentRef.id
        };
        await fb.addDoc(fb.collection(fb.db, 'notifications'), notificationData);
        
        this.selectedCourse.isEnrolled = true;
        this.selectedCourse.enrollmentStatus = 'pending';
        
        Swal.fire({
          icon: 'success',
          title: '수강 신청 완료',
          text: '강사 승인 후 수강이 확정됩니다.',
          confirmButtonColor: '#2563eb',
          timer: 2000,
          showConfirmButton: false
        });
      } catch (error) {
        console.error('Enrollment error:', error);
        Swal.fire({
          icon: 'error',
          title: '신청 실패',
          text: '수강 신청 중 오류가 발생했습니다.',
          confirmButtonColor: '#2563eb'
        });
      } finally {
        this.isApplying = false;
      }
    },
    
    getCategoryText(category) {
      const categoryMap = {
        'programming': '프로그래밍',
        'math': '수학',
        'science': '과학',
        'english': '영어',
        'korean': '국어',
        'social': '사회',
        'history': '역사',
        'art': '미술',
        'music': '음악',
        'physical': '체육',
        'other': '기타'
      };
      return categoryMap[category] || category;
    },
    
    getTargetGradeText(grade) {
      const gradeMap = {
        'elementary': '초등학생',
        'middle': '중학생',
        'high': '고등학생',
        'university': '대학생',
        'adult': '성인',
        'all': '전체'
      };
      return gradeMap[grade] || (grade ? grade + '학년' : '-');
    },

    getGreeting() {
      const hour = new Date().getHours();
      if (hour < 12) return '좋은 아침이에요';
      if (hour < 18) return '좋은 오후예요';
      return '좋은 저녁이에요';
    },

    // Pagination helpers
    get paginatedAnnouncements() {
      const start = (this.announcementPage - 1) * this.announcementsPerPage;
      return this.adminAnnouncements.slice(start, start + this.announcementsPerPage);
    },
    get totalAnnouncementPages() {
      return Math.ceil(this.adminAnnouncements.length / this.announcementsPerPage);
    },
    get announcementEmptySlots() {
      const count = this.paginatedAnnouncements.length;
      return count < this.announcementsPerPage ? this.announcementsPerPage - count : 0;
    },
    get visibleAnnouncementPages() {
      const pages = [];
      const maxVisible = 5;
      let start = Math.max(1, this.announcementPage - Math.floor(maxVisible / 2));
      let end = Math.min(this.totalAnnouncementPages, start + maxVisible - 1);
      if (end - start < maxVisible - 1) {
        start = Math.max(1, end - maxVisible + 1);
      }
      for (let i = start; i <= end; i++) {
        pages.push(i);
      }
      return pages;
    },
    get paginatedTickets() {
      const start = (this.ticketPage - 1) * this.ticketsPerPage;
      return this.myTickets.slice(start, start + this.ticketsPerPage);
    },
    get totalTicketPages() {
      return Math.ceil(this.myTickets.length / this.ticketsPerPage);
    },
    get ticketEmptySlots() {
      const count = this.paginatedTickets.length;
      return count < this.ticketsPerPage ? this.ticketsPerPage - count : 0;
    },
    get visibleTicketPages() {
      const pages = [];
      const maxVisible = 5;
      let start = Math.max(1, this.ticketPage - Math.floor(maxVisible / 2));
      let end = Math.min(this.totalTicketPages, start + maxVisible - 1);
      if (end - start < maxVisible - 1) {
        start = Math.max(1, end - maxVisible + 1);
      }
      for (let i = start; i <= end; i++) {
        pages.push(i);
      }
      return pages;
    },

    // Enrolled Courses Pagination
    get paginatedEnrolledCourses() {
      const start = (this.enrolledPage - 1) * this.enrolledPerPage;
      return this.enrolledCourses.slice(start, start + this.enrolledPerPage);
    },
    get totalEnrolledPages() {
      return Math.ceil(this.enrolledCourses.length / this.enrolledPerPage);
    },
    get enrolledEmptySlots() {
      const count = this.paginatedEnrolledCourses.length;
      return count < this.enrolledPerPage ? this.enrolledPerPage - count : 0;
    },
    get visibleEnrolledPages() {
      const pages = [];
      const maxVisible = 5;
      let start = Math.max(1, this.enrolledPage - Math.floor(maxVisible / 2));
      let end = Math.min(this.totalEnrolledPages, start + maxVisible - 1);
      if (end - start < maxVisible - 1) {
        start = Math.max(1, end - maxVisible + 1);
      }
      for (let i = start; i <= end; i++) {
        pages.push(i);
      }
      return pages;
    },

    // Recent Chats Pagination
    get paginatedRecentChats() {
      const start = (this.chatPage - 1) * this.chatsPerPage;
      return this.recentChats.slice(start, start + this.chatsPerPage);
    },
    get totalChatPages() {
      return Math.ceil(this.recentChats.length / this.chatsPerPage);
    },
    get chatEmptySlots() {
      const count = this.paginatedRecentChats.length;
      return count < this.chatsPerPage ? this.chatsPerPage - count : 0;
    },
    get visibleChatPages() {
      const pages = [];
      const maxVisible = 5;
      let start = Math.max(1, this.chatPage - Math.floor(maxVisible / 2));
      let end = Math.min(this.totalChatPages, start + maxVisible - 1);
      if (end - start < maxVisible - 1) {
        start = Math.max(1, end - maxVisible + 1);
      }
      for (let i = start; i <= end; i++) {
        pages.push(i);
      }
      return pages;
    },

    async loadAdminAnnouncements(fb) {
      const q = fb.query(
        fb.collection(fb.db, 'announcements'),
        fb.orderBy('isImportant', 'desc'),
        fb.orderBy('created_at', 'desc'),
        fb.limit(20)
      );
      
      fb.onSnapshot(q, (snap) => {
        this.adminAnnouncements = snap.docs.map(d => ({ 
          id: d.id, 
          ...d.data(),
          createdAt: d.data().created_at
        }));
      }, (err) => {
        console.warn('Admin announcements load error:', err);
        this.adminAnnouncements = [];
      });
    },

    showAnnouncementModal(notice) {
      const typeLabel = notice.isImportant ? '중요 공지' : '전체 공지';
      const typeColor = notice.isImportant ? '#dc2626' : '#2563eb';
      const typeBg = notice.isImportant ? '#fef2f2' : '#eff6ff';
      const dateStr = notice.createdAt ? this.formatRelativeTime(notice.createdAt) : '-';
      
      Swal.fire({
        html: `
          <div style="text-align:left;">
            <div style="display:flex; align-items:center; gap:0.5rem; margin-bottom:1rem;">
              <span style="padding:4px 12px; background:${typeBg}; color:${typeColor}; font-size:0.75rem; font-weight:600; border-radius:9999px;">${typeLabel}</span>
              <span style="font-size:0.875rem; color:#9ca3af;">${dateStr}</span>
            </div>
            <h2 style="font-size:1.25rem; font-weight:700; color:#111827; margin-bottom:1rem; line-height:1.4;">${notice.title}</h2>
            <div style="font-size:0.95rem; color:#374151; line-height:1.7; white-space:pre-wrap;">${notice.content || ''}</div>
          </div>
        `,
        showConfirmButton: true,
        confirmButtonText: '확인',
        confirmButtonColor: '#2563eb',
        width: '520px',
        customClass: {
          popup: 'announcement-modal-popup'
        }
      });
    },
    
    formatRelativeTime(timestamp) {
      if (!timestamp) return '-';
      const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
      const now = new Date();
      const diff = now - date;
      
      const minutes = Math.floor(diff / 60000);
      const hours = Math.floor(diff / 3600000);
      const days = Math.floor(diff / 86400000);
      
      if (minutes < 1) return '방금 전';
      if (minutes < 60) return `${minutes}분 전`;
      if (hours < 24) return `${hours}시간 전`;
      if (days < 7) return `${days}일 전`;
      return `${date.getFullYear()}.${String(date.getMonth()+1).padStart(2,'0')}.${String(date.getDate()).padStart(2,'0')}`;
    },

    async loadEnrolledCourses(fb, userId) {
      const q = fb.query(
        fb.collection(fb.db, 'courseEnrollments'),
        fb.where('studentId', '==', userId),
        fb.where('status', '==', 'approved')
      );
      fb.onSnapshot(q, (snap) => {
        this.enrolledCourses = snap.docs.map(d => {
          const data = { id: d.id, ...d.data() };
          return {
            ...data,
            progress: Math.round(Number(data.progress) || 0),
            completedLessons: Number(data.completedLessons) || 0,
            totalLessons: Number(data.totalLessons) || 0
          };
        });
      }, (err) => {
        console.warn('Enrolled courses load error:', err);
        this.enrolledCourses = [];
      });
    },

    getCourseProgressPercent(course) {
      return Math.max(0, Math.min(100, Math.round(Number(course?.progress) || 0)));
    },

    getCourseLessonSummary(course) {
      const completedLessons = Number(course?.completedLessons) || 0;
      const totalLessons = Number(course?.totalLessons) || 0;
      if (totalLessons > 0) {
        return `${completedLessons}/${totalLessons} 강의 완료`;
      }
      return this.getCourseProgressPercent(course) > 0 ? '진행 데이터 동기화 중' : '아직 학습 전';
    },

    getCourseProgressLabel(course) {
      const progress = this.getCourseProgressPercent(course);
      if (progress >= 100) return '모든 강의내용 수료 완료';
      if (progress >= 80) return '수료 직전';
      if (progress > 0) return '학습 진행 중';
      return '아직 시작 전';
    },

    getEnrolledCourseAverageProgress() {
      if (!this.enrolledCourses.length) return 0;
      const total = this.enrolledCourses.reduce((sum, course) => sum + this.getCourseProgressPercent(course), 0);
      return Math.round(total / this.enrolledCourses.length);
    },

    getFullyCompletedCourseCount() {
      return this.enrolledCourses.filter(course => this.getCourseProgressPercent(course) >= 100).length;
    },

    get enrolledInstructors() {
      const seen = new Set();
      return this.enrolledCourses
        .filter(e => {
          if (!e.instructorId || seen.has(e.instructorId)) return false;
          seen.add(e.instructorId);
          return true;
        })
        .map(e => ({ instructorId: e.instructorId, instructorName: e.instructorName || '' }));
    },

    async reapplyForCourse() {
      if (!this.selectedCourse || !this.user) return;
      this.isApplying = true;
      try {
        const fb = await _fbDash;
        let enrollmentId = null;
        const existingQ = fb.query(
          fb.collection(fb.db, 'courseEnrollments'),
          fb.where('courseId', '==', this.selectedCourse.id),
          fb.where('studentId', '==', this.user.uid)
        );
        const existingSnap = await fb.getDocs(existingQ);
        if (!existingSnap.empty) {
          enrollmentId = existingSnap.docs[0].id;
          await fb.updateDoc(fb.doc(fb.db, 'courseEnrollments', existingSnap.docs[0].id), {
            status: 'pending',
            appliedAt: fb.serverTimestamp(),
            rejectionReason: null
          });
        } else {
          const enrollmentRef = await fb.addDoc(fb.collection(fb.db, 'courseEnrollments'), {
            courseId: this.selectedCourse.id,
            courseTitle: this.selectedCourse.title,
            studentId: this.user.uid,
            studentName: this.user.displayName,
            studentEmail: this.user.email,
            status: 'pending',
            appliedAt: fb.serverTimestamp()
          });
          enrollmentId = enrollmentRef.id;
        }
        await fb.addDoc(fb.collection(fb.db, 'notifications'), {
          user_id: this.selectedCourse.instructorId,
          recipientId: this.selectedCourse.instructorId,
          type: 'new_enrollment',
          title: '수강 재신청',
          message: `${this.user.displayName} 학생이 "${this.selectedCourse.title}" 강의에 다시 수강 신청했습니다.`,
          read: false,
          created_at: fb.serverTimestamp(),
          courseId: this.selectedCourse.id,
          courseTitle: this.selectedCourse.title,
          studentId: this.user.uid,
          studentName: this.user.displayName,
          enrollmentId
        });
        this.selectedCourse.enrollmentStatus = 'pending';
        Swal.fire({ icon:'success', title:'재신청 완료', text:'강사 승인 후 수강이 확정됩니다.', confirmButtonColor:'#2563eb', timer:2000, showConfirmButton:false });
      } catch (err) {
        console.error('Reapply error:', err);
        Swal.fire({ icon:'error', title:'신청 실패', text:'수강 재신청 중 오류가 발생했습니다.', confirmButtonColor:'#2563eb' });
      } finally {
        this.isApplying = false;
      }
    }
  };
};
