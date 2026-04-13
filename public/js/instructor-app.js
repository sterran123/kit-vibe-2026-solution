import {
  auth, db, onAuthStateChanged, signOut,
  collection, doc, addDoc, getDoc, query, where, orderBy, limit,
  onSnapshot, serverTimestamp, updateDoc, getDocs
} from './firebase-init.js?v=4';

// Instructor App Alpine.js Data
dayjs.locale('ko');

window.instructorApp = function() {
  return {
    // State
    user: null,
    userInitials: '',
    photoURL: null,
    tickets: [],
    currentFilter: 'open',
    selectedTicket: null,
    selectedTicketUnsubscribe: null,
    showTicketModal: false,
    showNotifications: false,
    instructorResponse: '',
    isSubmitting: false,
    notifications: [],
    unreadCount: 0,
    notificationLegacyItems: [],
    notificationRecipientItems: [],
    notificationUnsubscribes: [],
    
    // Course Request State
    showCourseRequestModal: false,
    isSubmittingCourse: false,
    courseRequest: {
      title: '',
      description: '',
      category: '',
      targetGrade: '',
      maxStudents: '',
      startDate: '',
      endDate: '',
      schedule: '',
      notes: ''
    },
    
    // Approved Courses State
    approvedCourses: [],
    selectedCourse: null,
    showCourseDetailModal: false,
    courseStudentFilter: 'pending', // 'pending' | 'approved' | 'rejected'
    courseStudents: [], // Enrollments for selected course
    highlightEnrollmentStudentId: null,
    pendingTicketIdFromUrl: null,
    pendingCourseIdFromUrl: null,
    pendingInquiryIdFromUrl: null,
    pendingEnrollmentStudentIdFromUrl: null,
    shouldOpenEnrollmentModalFromUrl: false,
    shouldOpenCourseRequestModalFromUrl: false,

    // Schedule Change State
    showScheduleModal: false,
    newScheduleInput: '',
    newStartDateInput: '',
    newEndDateInput: '',
    
    // Course Edit State
    isEditingCourse: false,
    editedCourse: {
      id: '',
      title: '',
      description: '',
      category: '',
      targetGrade: '',
      maxStudents: '',
      startDate: '',
      endDate: '',
      schedule: '',
      notes: ''
    },
    
    // Stats
    stats: {
      open: 0,
      inProgress: 0,
      resolvedToday: 0,
      totalAnswered: 0
    },

    // Inquiry State
    inquiries: [],
    pendingInquiryCount: 0,
    respondedInquiryCount: 0,
    selectedInquiry: null,
    showInquiryModal: false,
    inquiryResponse: '',
    inquiryResponses: [],
    inquirySearch: '',
    inquiryStatusFilter: 'all',

    // Profile Dropdown & Modal
    showProfileDropdown: false,
    showProfileModal: false,
    profileForm: {
      displayName: '',
      phone: '',
      bio: '',
      specialty: ''
    },
    
    // Initialization
    async init() {
      const params = new URLSearchParams(window.location.search);
      this.pendingTicketIdFromUrl = params.get('ticketId');
      this.pendingCourseIdFromUrl = params.get('courseId');
      this.pendingInquiryIdFromUrl = params.get('inquiryId');
      this.pendingEnrollmentStudentIdFromUrl = params.get('studentId');
      this.shouldOpenEnrollmentModalFromUrl = params.get('openEnrollment') === '1';
      this.shouldOpenCourseRequestModalFromUrl = params.get('openCourseRequest') === '1';
      
      try {
        // Wait for Firebase auth
        onAuthStateChanged(auth, async (user) => {          
          if (user) {
            // role 확인 - 학생은 dashboard.html로 리다이렉트 (admin은 강사 대시보드 허용)
            try {
              const userDoc = await getDoc(doc(db, 'users', user.uid));
              if (userDoc.exists()) {
                const userData = userDoc.data();
                if (!['instructor', 'admin', 'staff'].includes(userData.role)) {
                  window.location.href = 'dashboard.html';
                  return;
                }
              }
            } catch (e) {
            }
            
            this.user = {
              uid: user.uid,
              email: user.email,
              displayName: user.displayName || user.email.split('@')[0],
              photoURL: user.photoURL
            };
            this.userInitials = this.getInitials(this.user.displayName);
            
            // Load user profile photo
            const profileDoc = await getDoc(doc(db, 'userProfiles', user.uid));
            if (profileDoc.exists()) {
              this.photoURL = profileDoc.data().photoURL || null;
            }
            
            // Load tickets
            await this.loadTickets();
            
            // Load inquiries for this instructor
            this.loadInquiries();
            
            // Load approved courses for this instructor
            this.loadApprovedCourses();
            
            // Debug: Check all course requests to verify data structure
            this.debugCheckCourseData();
            
            // Subscribe to notifications - wrap in setTimeout to ensure Alpine reactivity is ready
            setTimeout(() => {
              this.subscribeToNotifications();
            }, 100);

            if (this.shouldOpenCourseRequestModalFromUrl) {
              this.showCourseRequestModal = true;
              this.shouldOpenCourseRequestModalFromUrl = false;
              this.removeQueryParams(['openCourseRequest']);
            }
            
          } else {
            // Redirect to login if not authenticated
            window.location.href = 'login.html';
          }
        });
      } catch (error) {
      }
    },
    
    // Load all tickets
    async loadTickets() {
      if (!this.user) return;
      
      const q = query(
        collection(db, 'tickets'),
        orderBy('created_at', 'desc'),
        limit(50)
      );
      
      onSnapshot(q, (snapshot) => {
        this.tickets = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        
        this.updateStats();
        this.tryHandleTicketDeepLink();
      });
    },

    // Load inquiries for this instructor
    async loadInquiries() {
      if (!this.user) return;
      
      const q = query(
        collection(db, 'inquiries'),
        where('recipientId', '==', this.user.uid),
        orderBy('createdAt', 'desc'),
        limit(50)
      );
      
      onSnapshot(q, (snapshot) => {
        this.inquiries = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        
        this.updateInquiryStats();
        this.tryHandleInquiryDeepLink();
      }, (error) => {
      });
    },

    // Update inquiry stats
    updateInquiryStats() {
      if (!this.inquiries) return;
      this.pendingInquiryCount = this.inquiries.filter(i => i.status === 'pending').length;
      this.respondedInquiryCount = this.inquiries.filter(i => i.status === 'responded').length;
    },

    // Open inquiry detail
    async openInquiry(inquiry) {
      this.selectedInquiry = inquiry;
      this.inquiryResponse = '';
      this.showInquiryModal = true;
      
      // Load responses
      await this.loadInquiryResponses(inquiry.id);
    },

    // Load inquiry responses
    async loadInquiryResponses(inquiryId) {
      try {
        const q = query(
          collection(db, 'inquiry_responses'),
          where('inquiryId', '==', inquiryId),
          orderBy('createdAt', 'asc')
        );
        
        onSnapshot(q, (snapshot) => {
          this.inquiryResponses = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          }));
        });
      } catch (error) {
      }
    },

    // Submit inquiry response
    async submitInquiryResponse() {
      if (!this.inquiryResponse.trim() || !this.selectedInquiry) return;
      
      this.isSubmitting = true;
      
      try {
        // Add response
        await addDoc(collection(db, 'inquiry_responses'), {
          inquiryId: this.selectedInquiry.id,
          content: this.inquiryResponse.trim(),
          responderId: this.user.uid,
          responderName: this.user.displayName || '강사',
          createdAt: serverTimestamp()
        });
        
        // Update inquiry status
        await updateDoc(doc(db, 'inquiries', this.selectedInquiry.id), {
          status: 'responded',
          updatedAt: serverTimestamp(),
          responseCount: (this.selectedInquiry.responseCount || 0) + 1
        });
        
        // Send notification to student
        await addDoc(collection(db, 'notifications'), {
          user_id: this.selectedInquiry.senderId,
          title: '문의에 답변 도착',
          message: `'${this.selectedInquiry.title}'에 대한 답변이 등록되었습니다.`,
          type: 'inquiry_response',
          read: false,
          created_at: serverTimestamp(),
          link: 'contact.html'
        });
        
        this.inquiryResponse = '';
        
        Swal.fire({
          icon: 'success',
          title: '답변 등록 완료',
          text: '답변이 성공적으로 등록되었습니다.',
          timer: 1500,
          showConfirmButton: false
        });
        
      } catch (error) {
        Swal.fire({
          icon: 'error',
          title: '오류',
          text: '답변 등록 중 오류가 발생했습니다.',
          confirmButtonColor: '#2563eb'
        });
      } finally {
        this.isSubmitting = false;
      }
    },

    // Close inquiry (mark as resolved)
    async closeInquiry() {
      if (!this.selectedInquiry) return;
      
      try {
        await updateDoc(doc(db, 'inquiries', this.selectedInquiry.id), {
          status: 'closed',
          updatedAt: serverTimestamp()
        });
        
        this.showInquiryModal = false;
        this.selectedInquiry = null;
        
        Swal.fire({
          icon: 'success',
          title: '문의 종료',
          text: '문의가 종료되었습니다.',
          timer: 1500,
          showConfirmButton: false
        });
      } catch (error) {
      }
    },
    
    // Subscribe to notifications with real-time FCM
    subscribeToNotifications() {
      if (!this.user) {
        return;
      }
      

      this.notificationUnsubscribes.forEach((unsubscribe) => unsubscribe?.());
      this.notificationUnsubscribes = [];
      this.notificationLegacyItems = [];
      this.notificationRecipientItems = [];

      const subscribeByField = (fieldName, targetKey) => {
        const q = query(
          collection(db, 'notifications'),
          where(fieldName, '==', this.user.uid),
          where('read', '==', false),
          orderBy('created_at', 'desc'),
          limit(10)
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
          this[targetKey] = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          this.mergeNotifications();
        }, (error) => {
          this[targetKey] = [];
          this.mergeNotifications();
        });

        this.notificationUnsubscribes.push(unsubscribe);
      };

      subscribeByField('user_id', 'notificationLegacyItems');
      subscribeByField('recipientId', 'notificationRecipientItems');
      
      // Request FCM permission and subscribe
      this.initFCM();
    },

    mergeNotifications() {
      const merged = [...this.notificationLegacyItems, ...this.notificationRecipientItems];
      const deduped = Array.from(new Map(merged.map(item => [item.id, item])).values());
      deduped.sort((a, b) => this.getNotificationTimestamp(b) - this.getNotificationTimestamp(a));

      deduped.forEach(notification => {
        const existing = this.notifications.find(n => n.id === notification.id);
        if (!existing && (notification.created_at || notification.createdAt)) {
          this.showBrowserNotification(notification);
        }
      });

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
      const inquiryId = notification.inquiryId || notification.inquiry_id;
      const studentId = notification.studentId || notification.student_id;
      const notificationType = notification.type || '';

      if (postId) {
        return `community-post.html?id=${postId}&type=${postType}`;
      }

      if (ticketId) {
        return `instructor.html?ticketId=${ticketId}`;
      }

      if (inquiryId) {
        return `instructor.html?inquiryId=${inquiryId}`;
      }

      if (['new_enrollment', 'course_enrollment', 'enrollment_request'].includes(notificationType) && courseId) {
        const search = new URLSearchParams({ courseId, openEnrollment: '1' });
        if (studentId) {
          search.set('studentId', studentId);
        }
        return `instructor.html?${search.toString()}`;
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

    removeQueryParams(keys = []) {
      const params = new URLSearchParams(window.location.search);
      keys.forEach((key) => params.delete(key));
      const nextQuery = params.toString();
      const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}${window.location.hash || ''}`;
      window.history.replaceState({}, '', nextUrl);
    },

    tryHandleTicketDeepLink() {
      if (!this.pendingTicketIdFromUrl) return;
      const ticket = this.tickets.find(item => item.id === this.pendingTicketIdFromUrl);
      if (!ticket) return;
      this.openTicket(ticket);
      this.pendingTicketIdFromUrl = null;
      this.removeQueryParams(['ticketId']);
    },

    tryHandleCourseEnrollmentDeepLink() {
      if (!this.shouldOpenEnrollmentModalFromUrl || !this.pendingCourseIdFromUrl) return;
      const course = this.approvedCourses.find(item => item.id === this.pendingCourseIdFromUrl);
      if (course) {
        this.openCourseDetail(course, {
          filter: 'pending',
          studentId: this.pendingEnrollmentStudentIdFromUrl
        });
        this.pendingCourseIdFromUrl = null;
        this.pendingEnrollmentStudentIdFromUrl = null;
        this.shouldOpenEnrollmentModalFromUrl = false;
        this.removeQueryParams(['courseId', 'openEnrollment', 'studentId']);
        return;
      }

      this.openCourseDetail({ id: this.pendingCourseIdFromUrl }, {
        filter: 'pending',
        studentId: this.pendingEnrollmentStudentIdFromUrl
      });
      this.pendingCourseIdFromUrl = null;
      this.pendingEnrollmentStudentIdFromUrl = null;
      this.shouldOpenEnrollmentModalFromUrl = false;
      this.removeQueryParams(['courseId', 'openEnrollment', 'studentId']);
    },

    tryHandleInquiryDeepLink() {
      if (!this.pendingInquiryIdFromUrl) return;
      const inquiry = this.inquiries.find(item => item.id === this.pendingInquiryIdFromUrl);
      if (!inquiry) return;
      this.openInquiry(inquiry);
      this.pendingInquiryIdFromUrl = null;
      this.removeQueryParams(['inquiryId']);
    },
    
    // Initialize Firebase Cloud Messaging
    async initFCM() {
      try {
        // Check if Firebase Messaging is available
        const { getMessaging, getToken, onMessage } = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging.js');
        
        // Register service worker first
        if ('serviceWorker' in navigator) {
          try {
            const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
          } catch (swError) {
            return;
          }
        }
        
        const messaging = getMessaging();
        
        // Request notification permission
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
          
          // Get FCM token - VAPID key is optional, try without it first
          let token = null;
          try {
            // Try with the actual VAPID key from Firebase Console
            token = await getToken(messaging, {
              vapidKey: 'BPHewHyXV-ai5qYrv813yrYqEF1WAMUqIa5iOCIL9eHrWXDzQ3U7APwM7_gWW8Hdd9ruowCqRgTVF27LfR06GOU'
            });
          } catch (tokenError) {
            // Fallback: try without VAPID key
            try {
              token = await getToken(messaging);
            } catch (fallbackError) {
            }
          }
          
          if (token) {
            // Save token to user document
            await updateDoc(doc(db, 'users', this.user.uid), {
              fcm_token: token,
              updated_at: serverTimestamp()
            });
          }
          
          // Handle foreground messages
          onMessage(messaging, (payload) => {
            this.showBrowserNotification({
              title: payload.notification?.title || '새 알림',
              message: payload.notification?.body || '내용을 확인해주세요'
            });
          });
        }
      } catch (error) {
        // FCM is optional, continue without it - app works fine with just Firestore notifications
      }
    },
    
    // Show browser notification
    showBrowserNotification(notification) {
      // Check if browser notifications are supported and permitted
      if (!('Notification' in window)) {
        return;
      }
      
      if (Notification.permission === 'granted') {
        const title = notification.title || 'TutorBridge 알림';
        const options = {
          body: notification.message || '새로운 알림이 있습니다',
          icon: '/favicon.ico',
          tag: notification.id || 'general',
          requireInteraction: false
          // Note: 'actions' is only supported in ServiceWorkerRegistration.showNotification()
          // not in the standard Notification constructor
        };
        
        try {
          const notif = new Notification(title, options);
          
          notif.onclick = () => {
            window.focus();
            notif.close();
            // Open notifications modal
            this.showNotifications = true;
          };
        } catch (err) {
        
        }
      }
    },
    
    // Update statistics
    updateStats() {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      // Count pending/open tickets assigned to me or unassigned
      const myUid = this.user?.uid;
      this.stats.open = this.tickets.filter(t =>
        (t.status === 'open' || t.status === 'pending' || !t.status) &&
        (t.instructor_id === myUid || !t.instructor_id)
      ).length;
      this.stats.inProgress = this.tickets.filter(t => t.status === 'in-progress' && t.instructor_id === this.user?.uid).length;
      this.stats.resolvedToday = this.tickets.filter(t => {
        if (t.status !== 'resolved') return false;
        const resolvedDate = t.responded_at?.toDate?.() || new Date(t.responded_at);
        return resolvedDate >= today;
      }).length;
      this.stats.totalAnswered = this.tickets.filter(t => 
        t.instructor_id === this.user?.uid && t.status === 'resolved'
      ).length;
    },
    
    // Debug: Check all course requests to verify data structure
    async debugCheckCourseData() {
      if (!this.user) return;
      
      try {
        // Query all courses for this instructor (no status filter)
        const q = query(
          collection(db, 'courseRequests'),
          where('instructorId', '==', this.user.uid)
        );
        
        const snapshot = await getDocs(q);

        snapshot.docs.forEach((doc, index) => {
          const data = doc.data();
 /*         console.log(`Course ${index + 1}:`, {
            id: doc.id,
            title: data.title,
            status: data.status,
            instructorId: data.instructorId,
            instructorName: data.instructorName,
            approvedAt: data.approvedAt,
            hasApprovedAt: !!data.approvedAt,
            createdAt: data.createdAt
          }); */
        });
        
        // Also check if any have 'approved' status
        const approvedCount = snapshot.docs.filter(d => d.data().status === 'approved').length;        
      } catch (error) {
      }
    },
    
    // Load approved courses for this instructor
    loadApprovedCourses() {
      if (!this.user) return;
      
      // Primary query with ordering (requires composite index)
      const q = query(
        collection(db, 'courseRequests'),
        where('instructorId', '==', this.user.uid),
        where('status', '==', 'approved'),
        orderBy('approvedAt', 'desc')
      );
      
      onSnapshot(q, (snapshot) => {
        const courses = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })).sort((a, b) => {
          const aTime = a.approvedAt?.toMillis?.() || 0;
          const bTime = b.approvedAt?.toMillis?.() || 0;
          return bTime - aTime;
        });
        this.approvedCourses = courses;
        this.tryHandleCourseEnrollmentDeepLink();
      }, (error) => {
        
        // Fallback: Query without orderBy if index is not ready
        if (error.message && error.message.includes('index')) {
          this.loadApprovedCoursesFallback();
        }
      });
    },
    
    // Fallback query without orderBy (works without composite index)
    loadApprovedCoursesFallback() {
      if (!this.user) return;
      
      const q = query(
        collection(db, 'courseRequests'),
        where('instructorId', '==', this.user.uid),
        where('status', '==', 'approved')
      );
      
      onSnapshot(q, (snapshot) => {
        const courses = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        // Client-side sorting by approvedAt
        courses.sort((a, b) => {
          const aTime = a.approvedAt?.toMillis?.() || 0;
          const bTime = b.approvedAt?.toMillis?.() || 0;
          return bTime - aTime;
        });
        this.approvedCourses = courses;
        this.tryHandleCourseEnrollmentDeepLink();
      }, (error) => {
      });
    },
    
    // Open course detail modal and load enrollments
    openCourseDetail(course, options = {}) {
      this.selectedCourse = course;
      this.showCourseDetailModal = true;
      this.courseStudentFilter = options.filter || 'pending';
      this.highlightEnrollmentStudentId = options.studentId || null;
      if (course?.id && (!course.title || !course.description)) {
        this.loadCourseDetail(course.id);
      }
      this.loadCourseStudents(course.id);
    },

    async loadCourseDetail(courseId) {
      if (!courseId) return;
      try {
        const courseDoc = await getDoc(doc(db, 'courseRequests', courseId));
        if (!courseDoc.exists()) return;
        const courseData = { id: courseDoc.id, ...courseDoc.data() };
        this.selectedCourse = courseData;
        const existingIndex = this.approvedCourses.findIndex((item) => item.id === courseId);
        if (existingIndex === -1) {
          this.approvedCourses = [courseData, ...this.approvedCourses];
        } else {
          this.approvedCourses.splice(existingIndex, 1, courseData);
          this.approvedCourses = [...this.approvedCourses];
        }
      } catch (error) {

      }
    },
    
    // Load student enrollments for selected course
    loadCourseStudents(courseId) {
      if (!courseId) return;
            
      // Check if courseEnrollments collection exists, if not create a query for it
      const q = query(
        collection(db, 'courseEnrollments'),
        where('courseId', '==', courseId),
        orderBy('appliedAt', 'desc')
      );
      
      onSnapshot(q, (snapshot) => {
        this.courseStudents = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
      }, (error) => {
        if (error.code === 'permission-denied') {
          this.courseStudents = [];
          return;
        }

        if (error.message && error.message.includes('index')) {
          const fallbackQuery = query(
            collection(db, 'courseEnrollments'),
            where('courseId', '==', courseId)
          );

          onSnapshot(fallbackQuery, (fallbackSnapshot) => {
            this.courseStudents = fallbackSnapshot.docs
              .map(doc => ({
                id: doc.id,
                ...doc.data()
              }))
              .sort((a, b) => {
                const aTime = (a.appliedAt?.toMillis?.() || a.created_at?.toMillis?.() || 0);
                const bTime = (b.appliedAt?.toMillis?.() || b.created_at?.toMillis?.() || 0);
                return bTime - aTime;
              });
          }, (fallbackError) => {
            this.courseStudents = [];
          });
          return;
        }

        this.courseStudents = [];
      });
    },
    
    // Get filtered course students based on filter
    get filteredCourseStudents() {
      if (!this.courseStudents) return [];
      return this.courseStudents.filter(s => s.status === this.courseStudentFilter);
    },
    
    // Get student counts by status
    get courseStudentCounts() {
      if (!this.courseStudents) return { pending: 0, approved: 0, rejected: 0, total: 0 };
      return {
        pending: this.courseStudents.filter(s => s.status === 'pending').length,
        approved: this.courseStudents.filter(s => s.status === 'approved').length,
        rejected: this.courseStudents.filter(s => s.status === 'rejected').length,
        total: this.courseStudents.length
      };
    },
    
    // Approve student enrollment
    async approveStudent(student) {
      if (!this.selectedCourse || !student) return;
      
      try {
        await updateDoc(doc(db, 'courseEnrollments', student.id), {
          status: 'approved',
          processedAt: serverTimestamp(),
          processedBy: this.user.uid
        });
        
        // Create notification for student
        const notificationData = {
          user_id: student.studentId,
          recipientId: student.studentId,
          type: 'enrollment_approved',
          title: '강의 수강 승인 완료',
          message: `"${this.selectedCourse.title}" 강의 수강 신청이 승인되었습니다.`,
          read: false,
          created_at: serverTimestamp(),
          courseId: this.selectedCourse.id,
          courseTitle: this.selectedCourse.title,
          studentId: student.studentId,
          enrollmentId: student.id
        };
        await addDoc(collection(db, 'notifications'), notificationData);
        
        // Update local state
        const studentIndex = this.courseStudents.findIndex(s => s.id === student.id);
        if (studentIndex !== -1) {
          this.courseStudents[studentIndex].status = 'approved';
          this.courseStudents[studentIndex].processedAt = new Date();
          this.courseStudents = [...this.courseStudents];
        }
        
        Swal.fire({
          icon: 'success',
          title: '수강 승인 완료',
          text: `${student.studentName} 학생의 수강 신청을 승인했습니다.`,
          confirmButtonColor: '#2563eb',
          timer: 1500,
          showConfirmButton: false
        });
      } catch (error) {
        Swal.fire({
          icon: 'error',
          title: '승인 실패',
          text: '수강 신청 승인 중 오류가 발생했습니다.',
          confirmButtonColor: '#2563eb'
        });
      }
    },
    
    // Reject student enrollment
    async rejectStudent(student) {
      if (!this.selectedCourse || !student) return;
      
      const { value: reason } = await Swal.fire({
        title: '수강 신청 거절',
        text: '거절 사유를 입력해주세요 (선택사항)',
        input: 'textarea',
        inputPlaceholder: '예: 정원 초과, 선수과목 미이수 등',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        cancelButtonColor: '#6b7280',
        confirmButtonText: '거절',
        cancelButtonText: '취소'
      });
      
      if (reason === undefined) return; // Cancelled
      
      try {
        await updateDoc(doc(db, 'courseEnrollments', student.id), {
          status: 'rejected',
          processedAt: serverTimestamp(),
          processedBy: this.user.uid,
          rejectionReason: reason || ''
        });
        
        // Create notification for student
        const notificationData = {
          user_id: student.studentId,
          recipientId: student.studentId,
          type: 'enrollment_rejected',
          title: '강의 수강 신청 거절',
          message: `"${this.selectedCourse.title}" 강의 수강 신청이 거절되었습니다. ${reason ? '사유: ' + reason : ''}`,
          read: false,
          created_at: serverTimestamp(),
          courseId: this.selectedCourse.id,
          courseTitle: this.selectedCourse.title,
          studentId: student.studentId,
          enrollmentId: student.id
        };
        await addDoc(collection(db, 'notifications'), notificationData);
        
        // Update local state
        const studentIndex = this.courseStudents.findIndex(s => s.id === student.id);
        if (studentIndex !== -1) {
          this.courseStudents[studentIndex].status = 'rejected';
          this.courseStudents[studentIndex].processedAt = new Date();
          this.courseStudents[studentIndex].rejectionReason = reason || '';
          this.courseStudents = [...this.courseStudents];
        }
        
        Swal.fire({
          icon: 'info',
          title: '수강 신청 거절 완료',
          text: `${student.studentName} 학생의 수강 신청을 거절했습니다.`,
          confirmButtonColor: '#2563eb',
          timer: 1500,
          showConfirmButton: false
        });
      } catch (error) {
        Swal.fire({
          icon: 'error',
          title: '거절 실패',
          text: '수강 신청 거절 중 오류가 발생했습니다.',
          confirmButtonColor: '#2563eb'
        });
      }
    },
    
    // Close course detail modal
    closeCourseDetail() {
      this.showCourseDetailModal = false;
      this.selectedCourse = null;
      this.courseStudents = [];
      this.courseStudentFilter = 'pending';
      this.highlightEnrollmentStudentId = null;
      this.isEditingCourse = false;
    },

    // Save schedule change
    async saveScheduleChange() {
      if (!this.selectedCourse) return;
      if (!this.newScheduleInput && !this.newStartDateInput && !this.newEndDateInput) {
        Swal.fire({ icon: 'warning', title: '입력 필요', text: '변경할 일정 정보를 입력해주세요.', confirmButtonColor: '#2563eb' });
        return;
      }
      try {
        const updateData = {};
        if (this.newScheduleInput) updateData.schedule = this.newScheduleInput.trim();
        if (this.newStartDateInput) updateData.startDate = this.newStartDateInput;
        if (this.newEndDateInput) updateData.endDate = this.newEndDateInput;
        updateData.updatedAt = serverTimestamp();

        await updateDoc(doc(db, 'courseRequests', this.selectedCourse.id), updateData);

        // Update local selected course
        this.selectedCourse = { ...this.selectedCourse, ...updateData };

        // Send notification to enrolled students
        const enrolledSnap = await getDocs(query(
          collection(db, 'courseEnrollments'),
          where('courseId', '==', this.selectedCourse.id),
          where('status', '==', 'approved')
        ));
        for (const enrollDoc of enrolledSnap.docs) {
          const enrollment = enrollDoc.data();
          await addDoc(collection(db, 'notifications'), {
            user_id: enrollment.studentId,
            type: 'schedule_changed',
            title: '강의 일정 변경',
            message: `"${this.selectedCourse.title}" 강의 일정이 변경되었습니다. ${updateData.schedule ? '새 일정: ' + updateData.schedule : ''}`,
            read: false,
            created_at: serverTimestamp(),
            courseId: this.selectedCourse.id
          });
        }

        this.showScheduleModal = false;
        this.newScheduleInput = '';
        this.newStartDateInput = '';
        this.newEndDateInput = '';

        Swal.fire({ icon: 'success', title: '일정 변경 완료', text: '강의 일정이 업데이트되었습니다.', confirmButtonColor: '#2563eb', timer: 2000, showConfirmButton: false });
      } catch (error) {
        Swal.fire({ icon: 'error', title: '변경 실패', text: '일정 변경 중 오류가 발생했습니다.', confirmButtonColor: '#2563eb' });
      }
    },
    
    // Open course edit mode
    openCourseEdit() {
      if (!this.selectedCourse) return;
      
      // Populate edit form with current course data
      this.editedCourse = {
        id: this.selectedCourse.id,
        title: this.selectedCourse.title || '',
        description: this.selectedCourse.description || '',
        category: this.selectedCourse.category || '',
        targetGrade: this.selectedCourse.targetGrade || '',
        maxStudents: this.selectedCourse.maxStudents || '',
        startDate: this.selectedCourse.startDate || '',
        endDate: this.selectedCourse.endDate || '',
        schedule: this.selectedCourse.schedule || '',
        notes: this.selectedCourse.notes || ''
      };
      
      this.isEditingCourse = true;
    },
    
    // Cancel course edit
    cancelCourseEdit() {
      this.isEditingCourse = false;
      this.editedCourse = {
        id: '',
        title: '',
        description: '',
        category: '',
        targetGrade: '',
        maxStudents: '',
        startDate: '',
        endDate: '',
        schedule: '',
        notes: ''
      };
    },
    
    // Save course edits
    async saveCourseEdit() {
      if (!this.editedCourse.id) return;
      
      // Validation
      if (!this.editedCourse.title || !this.editedCourse.description || !this.editedCourse.category) {
        Swal.fire({
          icon: 'warning',
          title: '입력 필요',
          text: '강의명, 설명, 카테고리는 필수 입력 항목입니다.',
          confirmButtonColor: '#2563eb'
        });
        return;
      }
      
      try {
        const updateData = {
          title: this.editedCourse.title.trim(),
          description: this.editedCourse.description.trim(),
          category: this.editedCourse.category,
          targetGrade: this.editedCourse.targetGrade || 'all',
          maxStudents: parseInt(this.editedCourse.maxStudents) || 20,
          startDate: this.editedCourse.startDate || null,
          endDate: this.editedCourse.endDate || null,
          schedule: this.editedCourse.schedule.trim() || '',
          notes: this.editedCourse.notes.trim() || '',
          updatedAt: serverTimestamp()
        };
        
        await updateDoc(doc(db, 'courseRequests', this.editedCourse.id), updateData);
        
        // Update local state
        const courseIndex = this.approvedCourses.findIndex(c => c.id === this.editedCourse.id);
        if (courseIndex !== -1) {
          this.approvedCourses[courseIndex] = { 
            ...this.approvedCourses[courseIndex], 
            ...updateData,
            updatedAt: new Date()
          };
        }
        
        // Update selected course
        if (this.selectedCourse) {
          this.selectedCourse = { ...this.selectedCourse, ...updateData };
        }
        
        this.isEditingCourse = false;
        
        Swal.fire({
          icon: 'success',
          title: '강의 정보 수정 완료',
          text: '강의 정보가 성공적으로 업데이트되었습니다.',
          confirmButtonColor: '#2563eb',
          timer: 1500,
          showConfirmButton: false
        });
      } catch (error) {

        Swal.fire({
          icon: 'error',
          title: '수정 실패',
          text: '강의 정보 수정 중 오류가 발생했습니다.',
          confirmButtonColor: '#2563eb'
        });
      }
    },
    
    // Get filtered tickets
    get filteredTickets() {
      const myUid = this.user?.uid;
      switch (this.currentFilter) {
        case 'open':
          // Show pending/open tickets assigned to me OR unassigned
          return this.tickets.filter(t =>
            (t.status === 'open' || t.status === 'pending' || !t.status) &&
            (t.instructor_id === myUid || !t.instructor_id)
          );
        case 'in-progress':
          // Only show in-progress tickets assigned to me
          return this.tickets.filter(t =>
            t.status === 'in-progress' && t.instructor_id === myUid
          );
        case 'resolved':
          // Only show tickets I resolved
          return this.tickets.filter(t => t.status === 'resolved' && t.instructor_id === myUid);
        default:
          return this.tickets;
      }
    },
    
    // Open ticket detail
    async openTicket(ticket) {
      this.selectedTicket = ticket;
      this.instructorResponse = '';
      this.showTicketModal = true;
      
      // Unsubscribe from previous ticket subscription if exists
      if (this.selectedTicketUnsubscribe) {
        this.selectedTicketUnsubscribe();
        this.selectedTicketUnsubscribe = null;
      }
      
      // Subscribe to real-time updates for this ticket
      this.selectedTicketUnsubscribe = onSnapshot(doc(db, 'tickets', ticket.id), (docSnapshot) => {
        if (docSnapshot.exists()) {
          const data = docSnapshot.data();
          // Update follow-up messages in real-time
          if (data.follow_up_messages) {
            this.selectedTicket.follow_up_messages = data.follow_up_messages;
          }
        }
      });
      
      // Mark as read and move to in-progress (handles 'open', 'pending', or no status)
      if (ticket.status === 'open' || ticket.status === 'pending' || !ticket.status) {
        await updateDoc(doc(db, 'tickets', ticket.id), {
          read: true,
          status: 'in-progress',
          instructor_id: this.user.uid,
          instructor_name: this.user.displayName,
          instructor_email: this.user.email,
          updated_at: serverTimestamp()
        });
      }
      
      // Load chat messages if available
      if (ticket.chat_session_id) {
        try {
          const sessionDoc = await getDoc(doc(db, 'chat_sessions', ticket.chat_session_id));
          if (sessionDoc.exists()) {
            const data = sessionDoc.data();
            this.selectedTicket.messages = data.messages || [];
          }
        } catch (error) {
        }
      }
    },
    
    // Submit instructor response
    async submitResponse() {
      if (!this.instructorResponse.trim() || !this.selectedTicket) return;
      
      this.isSubmitting = true;
      
      try {
        const responseText = this.instructorResponse.trim();
        const hasExistingFollowUps = this.selectedTicket.follow_up_messages && this.selectedTicket.follow_up_messages.length > 0;
        
        // If there are follow-up messages, add to the array; otherwise save as first response
        if (hasExistingFollowUps) {
          // Add instructor reply to follow_up_messages array
          const newMessage = {
            role: 'instructor',
            content: responseText,
            timestamp: new Date()
          };
          
          const updatedMessages = [...(this.selectedTicket.follow_up_messages || []), newMessage];
          
          await updateDoc(doc(db, 'tickets', this.selectedTicket.id), {
            status: 'in-progress',
            follow_up_messages: updatedMessages,
            instructor_id: this.user.uid,
            instructor_name: this.user.displayName,
            instructor_email: this.user.email,
            updated_at: serverTimestamp()
          });
        } else {
          // First response - save as instructor_response
          await updateDoc(doc(db, 'tickets', this.selectedTicket.id), {
            status: 'in-progress',
            instructor_response: responseText,
            instructor_id: this.user.uid,
            instructor_name: this.user.displayName,
            instructor_email: this.user.email,
            responded_at: serverTimestamp(),
            updated_at: serverTimestamp()
          });
        }
        
        // Create notification for student with the actual response content
        await addDoc(collection(db, 'notifications'), {
          user_id: this.selectedTicket.student_uid || this.selectedTicket.student_id,
          type: 'ticket_resolved',
          title: '강사님이 답변을 남겼습니다',
          message: hasExistingFollowUps 
            ? `💬 추가 질문에 대한 답변: "${responseText.substring(0, 100)}${responseText.length > 100 ? '...' : ''}"`
            : `"${this.selectedTicket.title || '질문'}"에 대한 답변이 도착했습니다.`,
          ticket_id: this.selectedTicket.id,
          read: false,
          created_at: serverTimestamp()
        });
        
        // Close modal
        this.showTicketModal = false;
        this.instructorResponse = '';
        
        Swal.fire({
          icon: 'success',
          title: '답변이 전송되었습니다',
          text: '학생에게 알림이 발송되었습니다.',
          confirmButtonColor: '#2563eb',
          timer: 2000,
          showConfirmButton: false
        });
        
      } catch (error) {
        Swal.fire({
          icon: 'error',
          title: '오류가 발생했습니다',
          text: '답변 전송에 실패했습니다. 다시 시도해주세요.',
          confirmButtonColor: '#2563eb'
        });
      } finally {
        this.isSubmitting = false;
      }
    },
    
    // Close ticket (mark as resolved)
    async closeTicket() {
      if (!this.selectedTicket) return;
      try {
        await updateDoc(doc(db, 'tickets', this.selectedTicket.id), {
          status: 'resolved',
          updated_at: serverTimestamp()
        });
        // Notify student
        await addDoc(collection(db, 'notifications'), {
          user_id: this.selectedTicket.student_uid || this.selectedTicket.student_id,
          type: 'ticket_resolved',
          title: '질문이 해결됨으로 처리되었습니다',
          message: `"${this.selectedTicket.student_question?.substring(0, 30) || '질문'}" 이 해결됨으로 처리되었습니다.`,
          ticket_id: this.selectedTicket.id,
          read: false,
          created_at: serverTimestamp()
        });
        this.showTicketModal = false;
        Swal.fire({ icon: 'success', title: '질문이 해결됨으로 처리되었습니다', timer: 1500, showConfirmButton: false });
      } catch (e) {

      }
    },

    // Handle notification click - navigate like PC/mobile versions
    async handleNotification(notification) {
      // Mark as read
      await updateDoc(doc(db, 'notifications', notification.id), {
        read: true,
        updated_at: serverTimestamp()
      });
      
      this.showNotifications = false;

      this.notifications = this.notifications.filter(n => n.id !== notification.id);
      this.unreadCount = this.notifications.length;
      this.notificationLegacyItems = this.notificationLegacyItems.filter(n => n.id !== notification.id);
      this.notificationRecipientItems = this.notificationRecipientItems.filter(n => n.id !== notification.id);

      const courseId = notification.courseId || notification.course_id;
      const studentId = notification.studentId || notification.student_id;
      const ticketId = notification.ticketId || notification.ticket_id;
      const inquiryId = notification.inquiryId || notification.inquiry_id;

      if (ticketId) {
        const ticket = this.tickets.find(item => item.id === ticketId);
        if (ticket) {
          this.openTicket(ticket);
          return;
        }
      }

      if (inquiryId) {
        const inquiry = this.inquiries.find(item => item.id === inquiryId);
        if (inquiry) {
          this.openInquiry(inquiry);
          return;
        }
      }

      if (['new_enrollment', 'course_enrollment', 'enrollment_request'].includes(notification.type || '') && courseId) {
        const course = this.approvedCourses.find(item => item.id === courseId);
        if (course) {
          this.openCourseDetail(course, { filter: 'pending', studentId });
          return;
        }
      }

      const targetUrl = this.resolveNotificationUrl(notification);
      if (targetUrl) {
        window.location.href = targetUrl;
      }
    },
    
    // Refresh tickets
    async refreshTickets() {
      await this.loadTickets();
      Swal.fire({
        icon: 'success',
        title: '새로고침 완료',
        timer: 1000,
        showConfirmButton: false
      });
    },
    
    // Utility functions
    getInitials(name) {
      if (!name) return '?';
      return name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
    },
    
    formatDate(timestamp) {
      if (!timestamp) return '';
      const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
      return dayjs(date).format('MM월 DD일 HH:mm');
    },
    
    getStatusText(status) {
      const statusMap = {
        'open': '대기중',
        'in-progress': '진행중',
        'resolved': '해결됨'
      };
      return statusMap[status] || status;
    },
    
    get filteredInquiries() {
      let result = this.inquiries || [];
      
      // Status filter
      if (this.inquiryStatusFilter !== 'all') {
        result = result.filter(i => i.status === this.inquiryStatusFilter);
      }
      
      // Search filter
      if (this.inquirySearch.trim()) {
        const searchLower = this.inquirySearch.toLowerCase();
        result = result.filter(i => 
          (i.title || '').toLowerCase().includes(searchLower) ||
          (i.content || '').toLowerCase().includes(searchLower) ||
          (i.senderName || '').toLowerCase().includes(searchLower)
        );
      }
      
      return result;
    },
    
    renderMarkdown(content) {
      if (!content) return '';
      try {
        const html = marked.parse(content);
        return DOMPurify.sanitize(html);
      } catch (e) {
        return content;
      }
    },
    
    // Submit course creation request
    async submitCourseRequest() {
      if (!this.courseRequest.title || !this.courseRequest.description || !this.courseRequest.category) {
        Swal.fire({
          icon: 'warning',
          title: '입력 필요',
          text: '강의 제목, 설명, 카테고리는 필수 입력 항목입니다.',
          confirmButtonColor: '#2563eb'
        });
        return;
      }
      
      this.isSubmittingCourse = true;
      
      try {
        const courseData = {
          title: this.courseRequest.title.trim(),
          description: this.courseRequest.description.trim(),
          category: this.courseRequest.category,
          targetGrade: this.courseRequest.targetGrade || 'all',
          maxStudents: parseInt(this.courseRequest.maxStudents) || 20,
          startDate: this.courseRequest.startDate || null,
          endDate: this.courseRequest.endDate || null,
          schedule: this.courseRequest.schedule.trim() || '',
          notes: this.courseRequest.notes.trim() || '',
          instructorId: this.user.uid,
          instructorName: this.user.displayName,
          instructorEmail: this.user.email,
          status: 'pending',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        };
        
        await addDoc(collection(db, 'courseRequests'), courseData);
        
        Swal.fire({
          icon: 'success',
          title: '강의 개설 신청 완료',
          text: '관리자 검토 후 승인 여부가 알림으로 전송됩니다.',
          confirmButtonColor: '#2563eb',
          timer: 2000,
          showConfirmButton: false
        });
        
        // Reset form and close modal
        this.courseRequest = {
          title: '',
          description: '',
          category: '',
          targetGrade: '',
          maxStudents: '',
          startDate: '',
          endDate: '',
          schedule: '',
          notes: ''
        };
        this.showCourseRequestModal = false;
        
      } catch (error) {
        Swal.fire({
          icon: 'error',
          title: '신청 실패',
          text: '강의 개설 신청 중 오류가 발생했습니다. 다시 시도해주세요.',
          confirmButtonColor: '#2563eb'
        });
      } finally {
        this.isSubmittingCourse = false;
      }
    },
    
    // Load profile data from Firestore
    async loadProfile() {
      if (!this.user) return;
      try {
        const userDoc = await getDoc(doc(db, 'users', this.user.uid));
        if (userDoc.exists()) {
          const data = userDoc.data();
          this.profileForm = {
            displayName: data.displayName || this.user.displayName || '',
            phone: data.phone || '',
            bio: data.bio || '',
            specialty: data.specialty || ''
          };
        } else {
          this.profileForm = {
            displayName: this.user.displayName || '',
            phone: '',
            bio: '',
            specialty: ''
          };
        }
      } catch (e) {
      }
    },

    // Save profile to Firestore + Firebase Auth displayName
    async saveProfile() {
      if (!this.user) return;
      this.isSubmitting = true;
      try {
        // Update Firebase Auth displayName
        const { updateProfile } = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js');
        const authUser = auth.currentUser;
        if (authUser && this.profileForm.displayName) {
          await updateProfile(authUser, { displayName: this.profileForm.displayName });
        }

        // Update Firestore user document
        await updateDoc(doc(db, 'users', this.user.uid), {
          displayName: this.profileForm.displayName,
          phone: this.profileForm.phone,
          bio: this.profileForm.bio,
          specialty: this.profileForm.specialty,
          updated_at: serverTimestamp()
        });

        // Update local user state
        this.user = { ...this.user, displayName: this.profileForm.displayName };
        this.userInitials = this.getInitials(this.user.displayName);

        this.showProfileModal = false;

        Swal.fire({
          icon: 'success',
          title: '프로필이 저장되었습니다',
          timer: 1500,
          showConfirmButton: false,
          confirmButtonColor: '#2563eb'
        });
      } catch (error) {
        Swal.fire({
          icon: 'error',
          title: '저장 실패',
          text: '프로필 저장 중 오류가 발생했습니다.',
          confirmButtonColor: '#2563eb'
        });
      } finally {
        this.isSubmitting = false;
      }
    },

    async logout() {
      await signOut(auth);
      window.location.href = 'login.html';
    },
    
    // Translation helpers for category and target grade
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
    }
  };
};
