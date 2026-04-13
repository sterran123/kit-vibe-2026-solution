import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore, collection, query, where, onSnapshot, orderBy, limit, doc, updateDoc, getDoc, writeBatch } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
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

window.mobileDashboardApp = function() {
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
    completionRate: 0,
    showNotifications: false,
    
    // Pull to refresh
    isPulling: false,
    pullText: '당겨서 새로고침',
    startY: 0,
    
    init() {
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
            console.error('[Dashboard Mobile] Profile photo load error:', e);
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
          
          // Redirect instructors/admin/staff to instructor.html
          const isInstructorRole = ['instructor', 'admin', 'staff'].includes(this.userRole);
          if (isInstructorRole) {
            window.location.href = '/instructor.html';
            return;
          }
          
          this.loadMyCourses(user.uid);
          this.loadNotifications(user.uid);
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
    
    get showAiTutor() {
      return this.userRole !== 'instructor' && this.userRole !== 'admin' && this.userRole !== 'staff';
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
    
    loadMyCourses(userId) {
      
      const q = query(
        collection(db, 'courseEnrollments'),
        where('studentId', '==', userId),
        where('status', '==', 'approved')
      );
      
      onSnapshot(q, async (snapshot) => {
        try {
          const enrollments = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
          
          // Fetch course details
          const courses = [];
          let totalProgress = 0;
          
          for (const enrollment of enrollments) {
            const courseId = enrollment.courseId;
            if (!courseId) {
              console.warn('[Dashboard Mobile] Enrollment missing courseId:', enrollment.id);
              continue;
            }

            try {

              let courseDoc = await getDoc(doc(db, 'courseRequests', courseId));
              if (!courseDoc.exists()) {
                courseDoc = await getDoc(doc(db, 'courses', courseId));
              }

              if (courseDoc.exists()) {
                const courseData = courseDoc.data();
                courses.push({
                  id: courseId,
                  title: courseData.title || enrollment.courseTitle || '제목 없는 강의',
                  description: courseData.description || enrollment.description || '',
                  thumbnail: courseData.thumbnail || enrollment.thumbnail || '/assets/course-default.jpg',
                  category: courseData.category || enrollment.category || '기타',
                  instructorName: courseData.instructorName || enrollment.instructorName || '강사',
                  progress: Math.round(Number(enrollment.progress) || 0),
                  completedLessons: Number(enrollment.completedLessons) || 0,
                  totalLessons: Number(enrollment.totalLessons) || 0
                });
                totalProgress += (Math.round(Number(enrollment.progress) || 0));
              } else {
                console.warn('[Dashboard Mobile] Course not found, using enrollment fallback:', courseId);
                courses.push({
                  id: courseId,
                  title: enrollment.courseTitle || '제목 없는 강의',
                  description: enrollment.description || '',
                  thumbnail: enrollment.thumbnail || '/assets/course-default.jpg',
                  category: enrollment.category || '기타',
                  instructorName: enrollment.instructorName || '강사',
                  progress: Math.round(Number(enrollment.progress) || 0),
                  completedLessons: Number(enrollment.completedLessons) || 0,
                  totalLessons: Number(enrollment.totalLessons) || 0
                });
                totalProgress += (Math.round(Number(enrollment.progress) || 0));
              }
            } catch (courseErr) {
              console.error('[Dashboard Mobile] Error fetching course:', courseErr);
            }
          }
          
          this.myCourses = courses;
          this.completionRate = courses.length > 0 ? Math.round(totalProgress / courses.length) : 0;
        } catch (err) {
          console.error('[Dashboard Mobile] Error loading courses:', err);
        }
      }, (error) => {
        console.error('[Dashboard Mobile] Enrollments query error:', error);
      });
    },
    
    loadNotifications(userId) {
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

    async markAllRead() {
      const unread = this.notifications.filter(n => !n.read);
      for (const n of unread) {
        await updateDoc(doc(db, 'notifications', n.id), { read: true });
      }
    },
    
    async handleNotificationClick(notification) {
      
      // Mark as read
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
      } else {
      }
    },

    async handleNotification(notification) {
      await this.handleNotificationClick(notification);
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
      if (progress >= 100) return '수료 완료';
      if (progress >= 80) return '마무리 단계';
      if (progress > 0) return '학습 진행 중';
      return '아직 시작 전';
    },
    
    goToClassroom(courseId) {
      window.location.href = `/classroom.html?courseId=${courseId}`;
    },
    
    showToast(title, message) {
      // Simple toast using SweetAlert if available, otherwise console
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
