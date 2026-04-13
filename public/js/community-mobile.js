import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore, collection, query, where, onSnapshot, orderBy, limit, doc, updateDoc, addDoc, serverTimestamp, increment, getDoc, deleteDoc, setDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

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

window.mobileCommunityApp = function() {
  return {
    user: null,
    userRole: '',
    photoURL: null,
    posts: [],
    notifications: [],
    unreadCount: 0,
    notificationLegacyItems: [],
    notificationRecipientItems: [],
    notificationUnsubscribes: [],
    searchQuery: '',
    selectedCategory: '',
    showSearch: false,
    showNotifications: false,
    showWriteModal: false,
    showCategoryDrawer: false,
    categorySearch: '',
    postForm: { title: '', content: '', category: 'free' },
    
    get filteredCategories() {
      if (!this.categorySearch) return this.allCategories;
      const q = this.categorySearch.toLowerCase();
      return this.allCategories.filter(cat => 
        cat.name.toLowerCase().includes(q) || 
        cat.icon.includes(q)
      );
    },
    
    get allCategories() {
      return [
        { id: '', name: '전체', icon: '📋' },
        { id: 'announcement', name: '공지사항', icon: '📢' },
        { id: 'free', name: '자유게시판', icon: '💬' },
        { id: 'question', name: '질문게시판', icon: '❓' },
        { id: 'study', name: '스터디', icon: '📚' },
        { id: 'review', name: '수강후기', icon: '📝' },
        { id: 'attendance', name: '출석부', icon: '✅' },
        { id: 'gallery', name: '갤러리', icon: '🖼️' }
      ];
    },
    
    filterAnnouncement() {
      this.selectedCategory = 'announcement';
      this.showCategoryDrawer = false;
    },
    
    selectCategory(catId) {
      this.selectedCategory = catId;
      this.showCategoryDrawer = false;
    },
    
    init() {
      onAuthStateChanged(auth, async (user) => {
        if (user) {
          this.user = user;
          
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
//          console.log('[Community Mobile] User role set to:', this.userRole, 'showAiTutor:', this.showAiTutor);
          
          // Load user profile photo
          const profileDoc = await getDoc(doc(db, 'userProfiles', user.uid));
          if (profileDoc.exists()) {
            this.photoURL = profileDoc.data().photoURL || null;
          }
          
          this.loadPosts();
          this.loadNotifications(user.uid);
        } else {
          window.location.href = '/login.html';
        }
      });
    },
    
    get showAiTutor() {
      return this.userRole !== 'instructor' && this.userRole !== 'admin' && this.userRole !== 'staff';
    },
    
    loadPosts() {
      const announcementsQ = query(
        collection(db, 'announcements'),
        orderBy('created_at', 'desc'),
        limit(20)
      );

      let postsQ;
      if (this.selectedCategory) {
        postsQ = query(
          collection(db, 'posts'),
          where('category', '==', this.selectedCategory),
          orderBy('created_at', 'desc'),
          limit(50)
        );
      } else {
        postsQ = query(
          collection(db, 'posts'),
          orderBy('created_at', 'desc'),
          limit(50)
        );
      }

      onSnapshot(announcementsQ, (announcementSnap) => {
        const announcements = announcementSnap.docs.map(d => ({
          id: d.id,
          ...d.data(),
          createdAt: d.data().created_at,
          isAnnouncement: true,
          authorName: '관리자',
          category: d.data().category || 'announcement'
        }));

        onSnapshot(postsQ, (postSnap) => {
          const communityPosts = postSnap.docs.map(d => ({
            id: d.id,
            ...d.data(),
            createdAt: d.data().created_at || d.data().createdAt,
            isAnnouncement: false,
            authorName: d.data().authorName || d.data().author || '익명'
          }));

          this.posts = [...announcements, ...communityPosts].sort((a, b) => {
            const dateA = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt || 0);
            const dateB = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt || 0);
            return dateB - dateA;
          });

          console.log('[Community Mobile] Posts loaded:', this.posts.length);
        }, (postErr) => {
          console.error('[Community Mobile] Posts query error:', postErr);
          this.posts = [...announcements];
        });
      }, (announcementErr) => {
        console.error('[Community Mobile] Announcements query error:', announcementErr);

        onSnapshot(postsQ, (postSnap) => {
          this.posts = postSnap.docs.map(d => ({
            id: d.id,
            ...d.data(),
            createdAt: d.data().created_at || d.data().createdAt,
            isAnnouncement: false,
            authorName: d.data().authorName || d.data().author || '익명'
          }));
          console.log('[Community Mobile] Posts loaded without announcements:', this.posts.length);
        }, (postErr) => {
          console.error('[Community Mobile] Posts query error:', postErr);
          this.posts = [];
        });
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
      await updateDoc(doc(db, 'notifications', notification.id), { read: true });
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
    
    get filteredPosts() {
      let result = this.posts;

      if (this.selectedCategory) {
        const normalizedCategory = this.selectedCategory === 'questions' ? 'question' : this.selectedCategory;
        result = result.filter((p) => {
          if (normalizedCategory === 'question') {
            return p.category === 'question' || p.category === 'questions';
          }
          return p.category === normalizedCategory;
        });
      }
      
      if (this.searchQuery) {
        const q = this.searchQuery.toLowerCase();
        result = result.filter(p => 
          p.title?.toLowerCase().includes(q) ||
          p.content?.toLowerCase().includes(q)
        );
      }
      
      return result;
    },
    
    async votePost(postId, type) {
      if (!this.user) return;
      
      const postRef = doc(db, 'posts', postId);
      const voteRef = doc(db, 'posts', postId, 'votes', this.user.uid);
      
      try {
        const voteDoc = await getDoc(voteRef);
        const currentVote = voteDoc.exists() ? voteDoc.data().type : null;
        
        if (currentVote === type) {
          // Remove vote
          await updateDoc(postRef, {
            [type === 'up' ? 'upvotes' : 'downvotes']: increment(-1)
          });
          await deleteDoc(voteRef);
        } else {
          // Add/change vote
          if (currentVote) {
            await updateDoc(postRef, {
              [currentVote === 'up' ? 'upvotes' : 'downvotes']: increment(-1),
              [type === 'up' ? 'upvotes' : 'downvotes']: increment(1)
            });
          } else {
            await updateDoc(postRef, {
              [type === 'up' ? 'upvotes' : 'downvotes']: increment(1)
            });
          }
          await setDoc(voteRef, { type, createdAt: serverTimestamp() });
        }
      } catch (error) {
        console.error('Error voting:', error);
      }
    },
    
    goToPost(postId) {
      window.location.href = `/community-post.html?id=${postId}`;
    },
    
    openWriteModal() {
      this.postForm = { title: '', content: '', category: 'free' };
      this.showWriteModal = true;
    },
    
    closeWriteModal() {
      this.showWriteModal = false;
      this.postForm = { title: '', content: '', category: 'free' };
    },
    
    async createPost() {
      if (!this.postForm.title.trim() || !this.postForm.content.trim()) {
        alert('제목과 내용을 입력해주세요.');
        return;
      }
      
      try {
        await addDoc(collection(db, 'posts'), {
          title: this.postForm.title,
          content: this.postForm.content,
          category: this.postForm.category,
          authorId: this.user.uid,
          authorName: this.user.displayName || this.user.email,
          created_at: serverTimestamp(),
          viewCount: 0,
          upvotes: 0,
          downvotes: 0,
          commentCount: 0
        });
        
        this.closeWriteModal();
        alert('게시글이 등록되었습니다.');
      } catch (error) {
        console.error('Error creating post:', error);
        alert('게시글 등록에 실패했습니다.');
      }
    },
    
    getCategoryName(category) {
      const names = {
        announcement: '공지',
        free: '자유',
        question: '질문',
        questions: '질문',
        attendance: '출석',
        gallery: '갤러리',
        study: '스터디',
        review: '후기'
      };
      return names[category] || category;
    },
    
    stripHtml(html) {
      if (!html) return '';
      const tmp = document.createElement('div');
      tmp.innerHTML = html;
      return tmp.textContent || tmp.innerText || '';
    },
    
    getInitials(name) {
      if (!name) return 'U';
      return name.substring(0, 1).toUpperCase();
    },
    
    formatDate(timestamp) {
      if (!timestamp) return '';
      const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
      const now = new Date();
      const diff = (now - date) / 1000;
      
      if (diff < 60) return '방금';
      if (diff < 3600) return Math.floor(diff / 60) + '분 전';
      if (diff < 86400) return Math.floor(diff / 3600) + '시간 전';
      return date.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
    }
  };
};
