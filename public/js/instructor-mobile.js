import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore, collection, query, where, onSnapshot, orderBy, limit, doc, updateDoc, getDoc, getDocs, addDoc, serverTimestamp, writeBatch } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { getMessaging, onMessage } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging.js';

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
const messaging = getMessaging(app);

window.instructorMobileApp = function() {
  return {
    user: null,
    userRole: null,
    photoURL: null,
    myCourses: [],
    notifications: [],
    unreadCount: 0,
    notificationLegacyItems: [],
    notificationRecipientItems: [],
    notificationUnsubscribes: [],
    searchQuery: '',
    selectedCategory: '',
    showCourseRequestModal: false,
    isSubmittingCourse: false,
    shouldOpenCourseRequestModalFromUrl: false,
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
    
    // Stats
    totalCourses: 0,
    totalStudents: 0,
    pendingTickets: 0,
    
    showNotifications: false,
    
    // Pull to refresh
    isPulling: false,
    pullText: '당겨서 새로고침',
    startY: 0,
    
    init() {
      const params = new URLSearchParams(window.location.search);
      this.shouldOpenCourseRequestModalFromUrl = params.get('openCourseRequest') === '1';
      this.setupPullToRefresh();
      
      onAuthStateChanged(auth, async (user) => {
        if (user) {
          this.user = user;
          
          // Load profile photo from userProfiles
          try {
            const profileDoc = await getDoc(doc(db, 'userProfiles', user.uid));
            if (profileDoc.exists()) {
              this.photoURL = profileDoc.data().photoURL || null;
            }
          } catch (e) {
            console.error('[Instructor Mobile] Profile photo load error:', e);
          }
          
          // Load user role
          const adminDoc = await getDoc(doc(db, 'admins', user.uid));
          if (adminDoc.exists()) {
            this.userRole = 'admin';
          } else {
            const userDoc = await getDoc(doc(db, 'users', user.uid));
            if (userDoc.exists()) {
              this.userRole = userDoc.data().role;
            }
          }
          
          // Redirect students to dashboard-mobile.html
          const isStudentRole = this.userRole === 'student';
          if (isStudentRole) {
            window.location.href = '/dashboard-mobile.html';
            return;
          }
          
          this.loadMyCourses(user.uid);
          this.loadInstructorStats(user.uid);
          this.loadNotifications(user.uid);

          if (this.shouldOpenCourseRequestModalFromUrl) {
            this.showCourseRequestModal = true;
            this.shouldOpenCourseRequestModalFromUrl = false;
            this.removeQueryParams(['openCourseRequest']);
          }
        } else {
          window.location.href = '/login.html';
        }
      });
      
      // Handle FCM messages
      onMessage(messaging, (payload) => {
        this.showToast(payload.notification?.title || '새 알림', payload.notification?.body || '');
        if (this.user) {
          this.loadNotifications(this.user.uid);
        }
      });
    },
    
    setupPullToRefresh() {
      let touchStartY = 0;
      let isRefreshing = false;
      
      document.addEventListener('touchstart', (e) => {
        if (window.scrollY === 0) {
          touchStartY = e.touches[0].clientY;
        }
      }, { passive: true });
      
      document.addEventListener('touchmove', (e) => {
        if (window.scrollY === 0 && touchStartY > 0 && !isRefreshing) {
          const touchY = e.touches[0].clientY;
          const diff = touchY - touchStartY;
          
          if (diff > 60) {
            this.isPulling = true;
            this.pullText = diff > 100 ? '놓아서 새로고침' : '당겨서 새로고침';
          }
        }
      }, { passive: true });
      
      document.addEventListener('touchend', () => {
        if (this.isPulling && this.pullText === '놓아서 새로고침') {
          isRefreshing = true;
          this.pullText = '새로고침 중...';
          
          setTimeout(() => {
            location.reload();
          }, 500);
        } else {
          this.isPulling = false;
          this.pullText = '당겨서 새로고침';
        }
        touchStartY = 0;
      });
    },
    
    loadMyCourses(instructorId) {
      console.log('[Instructor Mobile] Loading courses for instructor:', instructorId);
      
      const q = query(
        collection(db, 'courseRequests'),
        where('instructorId', '==', instructorId),
        where('status', '==', 'approved')
      );
      
      onSnapshot(q, async (snapshot) => {
        try {
          const courses = [];
          
          for (const courseDoc of snapshot.docs) {
            const courseData = courseDoc.data();
            const courseId = courseDoc.id;
            
            // Get student count for this course
            const enrollQuery = query(
              collection(db, 'courseEnrollments'),
              where('courseId', '==', courseId),
              where('status', '==', 'approved')
            );
            const enrollSnap = await getDocs(enrollQuery);
            const studentCount = enrollSnap.docs.length;
            
            courses.push({
              id: courseId,
              title: courseData.title || '제목 없는 강의',
              description: courseData.description || '',
              thumbnail: courseData.thumbnail || '/assets/course-default.jpg',
              category: courseData.category || '기타',
              status: courseData.status || 'approved',
              studentCount: studentCount,
              createdAt: courseData.createdAt || courseData.approvedAt
            });
          }
          
          // Sort by created date desc
          courses.sort((a, b) => {
            const aTime = a.createdAt?.toMillis?.() || 0;
            const bTime = b.createdAt?.toMillis?.() || 0;
            return bTime - aTime;
          });
          
          this.myCourses = courses;
          this.totalCourses = courses.length;
          console.log('[Instructor Mobile] Courses loaded:', courses.length);
        } catch (err) {
          console.error('[Instructor Mobile] Error loading courses:', err);
        }
      }, (error) => {
        console.error('[Instructor Mobile] Courses query error:', error);
      });
    },
    
    loadInstructorStats(instructorId) {
      // Total students (unique)
      const enrollQuery = query(
        collection(db, 'courseEnrollments'),
        where('instructorId', '==', instructorId),
        where('status', '==', 'approved')
      );
      onSnapshot(enrollQuery, (snap) => {
        this.totalStudents = snap.docs.length;
      });
      
      // Pending tickets
      const ticketQuery = query(
        collection(db, 'tickets'),
        where('instructor_id', '==', instructorId),
        where('status', 'in', ['pending', 'in-progress'])
      );
      onSnapshot(ticketQuery, (snap) => {
        this.pendingTickets = snap.docs.length;
      });
    },
    
    loadNotifications(userId) {
      console.log('[LoadNotifications] Loading for user:', userId);
      this.notificationUnsubscribes.forEach((unsubscribe) => unsubscribe?.());
      this.notificationUnsubscribes = [];
      this.notificationLegacyItems = [];
      this.notificationRecipientItems = [];

      const subscribeByField = (fieldName, targetKey) => {
        const q = query(
          collection(db, 'notifications'),
          where(fieldName, '==', userId),
          where('read', '==', false),
          orderBy('created_at', 'desc')
        );
        const unsubscribe = onSnapshot(q, (snapshot) => {
          this[targetKey] = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
          this.mergeNotifications();
          console.log(`[LoadNotifications] ${fieldName} loaded:`, this[targetKey].length);
        }, (err) => {
          console.error(`[LoadNotifications] Error (${fieldName}):`, err);
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

    removeQueryParams(keys = []) {
      const params = new URLSearchParams(window.location.search);
      keys.forEach((key) => params.delete(key));
      const nextQuery = params.toString();
      const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}${window.location.hash || ''}`;
      window.history.replaceState({}, '', nextUrl);
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
        return `instructor.html?ticketId=${ticketId}`;
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
    
    async deleteNotification(notification) {
      try {
        await updateDoc(doc(db, 'notifications', notification.id), { read: true });
        this.notifications = this.notifications.filter(n => n.id !== notification.id);
        this.unreadCount = this.notifications.length;
      } catch (err) {
        console.error('Delete notification error:', err);
      }
    },

    async markAllNotificationsRead() {
      try {
        const batch = writeBatch(db);
        this.notifications.forEach(n => {
          const ref = doc(db, 'notifications', n.id);
          batch.update(ref, { read: true });
        });
        await batch.commit();
        this.notifications = [];
        this.unreadCount = 0;
      } catch (err) {
        console.error('Mark all notifications read error:', err);
      }
    },
    
    async handleNotificationClick(notification) {
      console.log('[Notification Click]', notification);
      
      try {
        await updateDoc(doc(db, 'notifications', notification.id), { read: true });
      } catch (e) {
        console.error('Mark read error:', e);
      }
      
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

    resetCourseRequestForm() {
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
    },

    openCourseRequestModal() {
      this.showCourseRequestModal = true;
    },

    closeCourseRequestModal() {
      this.showCourseRequestModal = false;
    },

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

      if (!this.user) return;

      this.isSubmittingCourse = true;

      try {
        await addDoc(collection(db, 'courseRequests'), {
          title: this.courseRequest.title.trim(),
          description: this.courseRequest.description.trim(),
          category: this.courseRequest.category,
          targetGrade: this.courseRequest.targetGrade || 'all',
          maxStudents: parseInt(this.courseRequest.maxStudents, 10) || 20,
          startDate: this.courseRequest.startDate || null,
          endDate: this.courseRequest.endDate || null,
          schedule: (this.courseRequest.schedule || '').trim(),
          notes: (this.courseRequest.notes || '').trim(),
          instructorId: this.user.uid,
          instructorName: this.user.displayName || this.user.email?.split('@')[0] || '강사',
          instructorEmail: this.user.email || '',
          status: 'pending',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });

        Swal.fire({
          icon: 'success',
          title: '강의 개설 신청 완료',
          text: '관리자 검토 후 승인 여부가 알림으로 전송됩니다.',
          confirmButtonColor: '#2563eb',
          timer: 2000,
          showConfirmButton: false
        });

        this.resetCourseRequestForm();
        this.showCourseRequestModal = false;
      } catch (error) {
        console.error('Course request error:', error);
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
    
    get filteredCourses() {
      let result = this.myCourses;
      
      if (this.selectedCategory) {
        result = result.filter(c => c.category === this.selectedCategory);
      }
      
      if (this.searchQuery) {
        const q = this.searchQuery.toLowerCase();
        result = result.filter(c => 
          c.title?.toLowerCase().includes(q) ||
          c.description?.toLowerCase().includes(q)
        );
      }
      
      return result;
    },
    
    goToClassroom(courseId) {
      window.location.href = `/classroom.html?courseId=${courseId}`;
    },
    
    getStatusText(status) {
      const statusMap = {
        'active': '진행중',
        'pending': '검토중',
        'rejected': '거부됨',
        'completed': '완료'
      };
      return statusMap[status] || status;
    },
    
    getStatusColor(status) {
      const colorMap = {
        'active': '#10b981',
        'pending': '#f59e0b',
        'rejected': '#ef4444',
        'completed': '#6b7280'
      };
      return colorMap[status] || '#6b7280';
    },
    
    showToast(title, message) {
      if (typeof Swal !== 'undefined') {
        Swal.fire({
          title,
          text: message,
          toast: true,
          position: 'top-end',
          showConfirmButton: false,
          timer: 3000,
          timerProgressBar: true
        });
      }
    },
    
    formatDate(timestamp) {
      if (!timestamp) return '';
      const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
      return date.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
    }
  };
};
