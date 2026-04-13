import {
  auth, db, onAuthStateChanged, signOut,
  collection, doc, getDoc, query, where, orderBy,
  onSnapshot, serverTimestamp, addDoc, updateDoc, deleteDoc,
  getDocs
} from './firebase-init.js?v=4';

window.communityApp = function() {
  return {
    user: null,
    userRole: '',
    // Posts State
    posts: [],
    postForm: { id: null, title: '', content: '', category: 'free', isNotice: false, noticeScope: 'board' },
    showPostModal: false,
    showDetailModal: false,
    quillEditor: null,
    
    // Topic & Pagination
    activeTopic: 'all',
    postScope: 'all',
    currentPage: 1,
    postsPerPage: 10,
    
    // Search
    searchQuery: '',
    isSearching: false,
    
    // Comments
    comments: [],
    newComment: '',
    selectedPost: {},
    
    // User Info
    userRole: '',
    
    // Notifications & Profile
    showNotifications: false,
    showProfileDropdown: false,
    notifications: [],
    unreadCount: 0,
    notificationLegacyItems: [],
    notificationRecipientItems: [],
    notificationUnsubscribes: [],
    userInitials: '',
    photoURL: null,
    
    // Category Labels
    categoryLabels: {
      'free': '자유게시판',
      'question': '질문게시판',
      'attendance': '출석부',
      'gallery': '갤러리'
    },
    
    async init() {
      dayjs.locale('ko');
      
      onAuthStateChanged(auth, async (user) => {
        if (!user) {
          window.location.href = 'login.html';
          return;
        }
        this.user = user;
        
        // Set user initials
        this.userInitials = user.displayName ? user.displayName.charAt(0).toUpperCase() : (user.email ? user.email.charAt(0).toUpperCase() : 'U');
        
        // Load user profile photo
        const profileDoc = await getDoc(doc(db, 'userProfiles', user.uid));
        
        if (profileDoc.exists()) {
          this.photoURL = profileDoc.data().photoURL || null;
          
        }
        
        // Load notifications
        this.loadNotifications();
        
        // Check user role (admins 컬렉션 우선 체크)
        const adminDoc = await getDoc(doc(db, 'admins', user.uid));
        if (adminDoc.exists()) {
          this.userRole = 'admin';
        } else {
          const userDoc = await getDoc(doc(db, 'users', user.uid));
          if (userDoc.exists()) {
            this.userRole = userDoc.data().role;
          }
        }
        
        
        this.loadPosts();
        
        // Handle URL parameters for direct post access
        const urlParams = new URLSearchParams(window.location.search);
        const postId = urlParams.get('postId');
        const type = urlParams.get('type');
        
        if (postId) {
          // Wait for posts to load, then open detail
          setTimeout(() => {
            const post = this.posts.find(p => p.id === postId);
            if (post) {
              this.openPostDetail(post);
            } else if (type === 'announcement') {
              // Try to load from announcements directly
              this.loadAndOpenAnnouncement(postId);
            }
          }, 1000);
        }
      });
    },

    async loadAndOpenAnnouncement(postId) {
      try {
        const docSnap = await getDoc(doc(db, 'announcements', postId));
        if (docSnap.exists()) {
          const post = {
            id: docSnap.id,
            ...docSnap.data(),
            createdAt: docSnap.data().created_at,
            isAnnouncement: true,
            authorName: '관리자'
          };
          this.openPostDetail(post);
        }
      } catch (error) {
        console.error('Load announcement error:', error);
      }
    },

    // Load all posts (announcements from admin + community posts)
    loadPosts() {
      // Load admin announcements
      const announcementsQ = query(
        collection(db, 'announcements'),
        orderBy('created_at', 'desc')
      );
      
      // Load community posts
      const postsQ = query(
        collection(db, 'posts'),
        orderBy('created_at', 'desc')
      );
      
      // Subscribe to announcements
      onSnapshot(announcementsQ, (snapshot) => {
        const announcements = snapshot.docs.map(d => ({
          id: d.id,
          ...d.data(),
          createdAt: d.data().created_at,
          isAnnouncement: true,
          authorName: '관리자'
        }));
        
        // Subscribe to community posts
        onSnapshot(postsQ, (postsSnap) => {
          const communityPosts = postsSnap.docs.map(d => ({
            id: d.id,
            ...d.data(),
            createdAt: d.data().created_at,
            isAnnouncement: false
          }));
          
          // Merge and sort: announcements first, then by date
          this.posts = [...announcements, ...communityPosts].sort((a, b) => {
            // First sort by isImportant (announcements are always important)
            if (a.isImportant && !b.isImportant) return -1;
            if (!a.isImportant && b.isImportant) return 1;
            // Then sort by date
            const dateA = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt);
            const dateB = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt);
            return dateB - dateA;
          });
        });
      });
    },

    get canCreateNotice() {
      return this.userRole === 'admin' || this.userRole === 'staff' || this.userRole === 'instructor';
    },

    get isInstructorSide() {
      return ['instructor', 'admin', 'staff'].includes(this.userRole);
    },

    get isMyPostsMode() {
      return this.postScope === 'mine';
    },

    get myPostsCount() {
      if (!this.user?.uid) return 0;
      return (this.posts || []).filter(post => post?.authorId === this.user.uid).length;
    },
    
    getCategoryLabel(category) {
      return this.categoryLabels[category] || category;
    },

    // 상단 고정 공지 (전체공지 + 현재 게시판 공지)
    get pinnedPosts() {
      if (!this.posts || !Array.isArray(this.posts)) return [];
      if (this.postScope === 'mine') return [];
      
      const topic = this.activeTopic;
      return this.posts.filter(p => {
        if (!p) return false;
        // 전체 공지 (isAnnouncement or noticeScope === 'global')
        if (p.isAnnouncement || p.noticeScope === 'global' || p.isImportant) return true;
        // 게시판별 공지
        if (p.isNotice && p.noticeScope === 'board') {
          if (topic === 'all') return true;
          return p.category === topic;
        }
        return false;
      }).sort((a, b) => {
        // 전체공지가 먼저, 그 다음 게시판 공지
        const aIsGlobal = a.isAnnouncement || a.noticeScope === 'global' || a.isImportant;
        const bIsGlobal = b.isAnnouncement || b.noticeScope === 'global' || b.isImportant;
        if (aIsGlobal && !bIsGlobal) return -1;
        if (!aIsGlobal && bIsGlobal) return 1;
        // 날짜순
        const dateA = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt);
        const dateB = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt);
        return dateB - dateA;
      });
    },
    
    // 일반 게시글 (공지 제외)
    get regularPosts() {
      if (!this.posts || !Array.isArray(this.posts)) return [];
      
      const topic = this.activeTopic;
      const pinnedIds = new Set((this.pinnedPosts || []).map(p => p?.id).filter(Boolean));
      
      let filtered = this.posts.filter(p => {
        if (!p) return false;
        
        // 공지 제외
        if (pinnedIds.has(p.id)) return false;
        
        if (topic === 'all') return true;
        return p.category === topic;
      });
      
      // 페이지네이션 적용
      const start = (this.currentPage - 1) * this.postsPerPage;
      return filtered.slice(start, start + this.postsPerPage);
    },

    get regularTotalPages() {
      const topic = this.activeTopic;
      const pinnedIds = new Set(this.pinnedPosts.map(p => p.id));
      const totalPosts = this.posts.filter(p => !pinnedIds.has(p.id) && (topic === 'all' || p.category === topic)).length;
      return Math.ceil(totalPosts / this.postsPerPage);
    },

    get regularVisiblePages() {
      const maxVisible = 5;
      const pages = [];
      const total = this.regularTotalPages;
      const current = this.currentPage;
      
      if (total <= maxVisible) {
        for (let i = 1; i <= total; i++) pages.push(i);
      } else {
        let start = Math.max(1, current - 2);
        let end = Math.min(total, current + 2);
        if (end - start < maxVisible - 1) {
          if (start === 1) end = Math.min(total, start + maxVisible - 1);
          else if (end === total) start = Math.max(1, end - maxVisible + 1);
        }
        for (let i = start; i <= end; i++) pages.push(i);
      }
      return pages;
    },
    
    // 검색 및 필터링된 게시글 (공지사항 제외 - 화면 표시용)
    get filteredPosts() {
      if (!this.posts || !Array.isArray(this.posts)) return [];
      
      const topic = this.activeTopic;
      const scope = this.postScope;
      const pinnedIds = new Set((this.pinnedPosts || []).map(p => p?.id).filter(Boolean));
      const query = (this.searchQuery || '').toLowerCase().trim();
      
      let filtered = this.posts.filter(p => {
        if (!p) return false;
        
        // 공지 제외
        if (pinnedIds.has(p.id)) return false;

        if (scope === 'mine' && p.authorId !== this.user?.uid) return false;
        
        // 카테고리 필터
        if (scope !== 'mine' && topic !== 'all' && p.category !== topic) return false;
        
        // 검색어 필터
        if (query) {
          const titleMatch = (p.title || '').toLowerCase().includes(query);
          const contentMatch = (p.content || '').toLowerCase().includes(query);
          const authorMatch = (p.authorName || '').toLowerCase().includes(query);
          return titleMatch || contentMatch || authorMatch;
        }
        
        return true;
      });
      
      return filtered;
    },

    // 페이징된 게시글 (공지 포함하여 첫 페이지 계산)
    get paginatedPosts() {
      const filtered = this.filteredPosts;
      if (!filtered || !Array.isArray(filtered)) return [];
      
      // 첫 페이지: 공지 수만큼 빼서 일반 게시글 표시
      // 두 페이지 이상: 첫 페이지에 표시된 일반 게시글 수만큼 skip
      const pinnedCount = (this.pinnedPosts || []).length;
      const firstPageRegularCount = Math.max(0, this.postsPerPage - pinnedCount);
      
      if (this.currentPage === 1) {
        // 첫 페이지: 공지를 제외한 남은 슬롯만큼만 일반 게시글 표시
        return filtered.slice(0, firstPageRegularCount);
      }
      
      // 두 페이지 이상: 첫 페이지에 표시된 게시글 수만큼 skip
      const start = firstPageRegularCount + (this.currentPage - 2) * this.postsPerPage;
      return filtered.slice(start, start + this.postsPerPage);
    },

    // 공지사항 포함한 전체 게시글 수 기준 페이지 수
    get totalPages() {
      if (!this.posts || !Array.isArray(this.posts)) return 0;
      
      const pinnedCount = (this.pinnedPosts || []).length;
      const regularCount = this.filteredPosts.length;
      
      // 첫 페이지 슬롯: 공지 제외한 나머지
      const firstPageSlots = Math.max(0, this.postsPerPage - pinnedCount);
      
      // 일반 게시글이 첫 페이지 슬롯보다 적으면 1페이지만
      if (regularCount <= firstPageSlots) return 1;
      
      // 남은 일반 게시글로 추가 페이지 계산
      const remainingRegular = regularCount - firstPageSlots;
      return 1 + Math.ceil(remainingRegular / this.postsPerPage);
    },

    // 공지사항 포함한 필터링된 전체 게시글
    get allFilteredPosts() {
      if (!this.posts || !Array.isArray(this.posts)) return [];
      
      const topic = this.activeTopic;
      const scope = this.postScope;
      const query = (this.searchQuery || '').toLowerCase().trim();
      
      return this.posts.filter(p => {
        if (!p) return false;

        if (scope === 'mine' && p.authorId !== this.user?.uid) return false;
        
        // 카테고리 필터
        if (scope !== 'mine' && topic !== 'all' && p.category !== topic) return false;
        
        // 검색어 필터
        if (query) {
          const titleMatch = (p.title || '').toLowerCase().includes(query);
          const contentMatch = (p.content || '').toLowerCase().includes(query);
          const authorMatch = (p.authorName || '').toLowerCase().includes(query);
          return titleMatch || contentMatch || authorMatch;
        }
        
        return true;
      });
    },
    
    get announcementPosts() {
      return this.posts.filter(p => p.isAnnouncement || p.noticeScope === 'global' || p.isImportant);
    },

    get popularPosts() {
      return [...this.posts]
        .sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0))
        .slice(0, 5);
    },

    getTopicTitle(topic) {
      if (this.postScope === 'mine') {
        return '👤 내 글';
      }
      const titles = {
        'all': '🏠 전체 글',
        'notice': '📢 공지사항',
        'free': '💬 자유게시판',
        'question': '❓ 질문게시판',
        'attendance': '✅ 출석부',
        'gallery': '🖼️ 갤러리'
      };
      return titles[topic] || '🏠 전체 글';
    },

    setTopic(topic) {
      this.activeTopic = topic;
      this.postScope = 'all';
      this.currentPage = 1;
      this.searchQuery = '';
    },

    goToDashboard() {
      window.location.href = this.isInstructorSide
        ? (window.innerWidth <= 768 ? 'instructor-mobile.html' : 'instructor.html')
        : (window.innerWidth <= 768 ? 'dashboard-mobile.html' : 'dashboard.html');
    },

    goToRoleMyPage() {
      window.location.href = this.isInstructorSide ? 'instructorpage.html' : 'mypage.html';
    },

    goToRoleCourses() {
      window.location.href = this.isInstructorSide ? 'instructor.html' : 'my-courses.html';
    },

    openCourseRequestShortcut() {
      window.location.href = window.innerWidth <= 768 ? 'instructor-mobile.html?openCourseRequest=1' : 'instructor.html?openCourseRequest=1';
    },

    goToPost(post) {
      if (!post || !post.id) return;
      // 상세 페이지로 이동
      const type = post.isAnnouncement || post.noticeScope === 'global' ? 'announcement' : 'post';
      window.location.href = `community-post.html?id=${post.id}&type=${type}`;
    },
    
    async incrementViewCount(post) {
      if (!post || !post.id || post.isAnnouncement) return;
      try {
        await updateDoc(doc(db, 'posts', post.id), {
          viewCount: (post.viewCount || 0) + 1
        });
      } catch (e) {
        // Silent fail
      }
    },

    goToMyPosts() {
      this.postScope = 'mine';
      this.activeTopic = 'all';
      this.currentPage = 1;
      this.searchQuery = '';
    },

    isNewPost(timestamp) {
      if (!timestamp) return false;
      const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
      const now = new Date();
      const diff = now - date;
      return diff < 24 * 60 * 60 * 1000; // Less than 24 hours
    },

    stripHtml(html) {
      if (!html) return '';
      return html.replace(/<[^>]*>/g, '');
    },

    openNewPostModal() {
      this.postForm = { id: null, title: '', content: '', category: 'free', isNotice: false, noticeScope: 'board' };
      this.showPostModal = true;
      this.$nextTick(() => {
        this.initQuillEditor();
      });
    },

    openEditModal(post) {
      this.selectedPost = post;
      this.postForm = {
        id: post.id,
        title: post.title,
        content: post.content
      };
      this.showDetailModal = false;
      this.showPostModal = true;
      this.$nextTick(() => {
        this.initQuillEditor();
      });
    },

    initQuillEditor() {
      const editorContainer = document.getElementById('post-editor');
      if (!editorContainer) return;
      
      // 기존 Quill 에디터 완전 제거 (ql-toolbar, ql-container 모두 제거)
      if (this.quillEditor) {
        this.quillEditor = null;
      }
      // Quill이 생성한 모든 클래스 요소 제거
      const existingToolbars = editorContainer.parentElement?.querySelectorAll('.ql-toolbar');
      existingToolbars?.forEach(el => el.remove());
      // 컨테이너 완전 초기화
      editorContainer.innerHTML = '';
      editorContainer.className = '';
      
      this.quillEditor = new Quill('#post-editor', {
        theme: 'snow',
        placeholder: '내용을 입력하세요...',
        modules: {
          toolbar: [
            [{ 'header': [1, 2, 3, false] }],
            ['bold', 'italic', 'underline', 'strike'],
            [{ 'color': [] }, { 'background': [] }],
            [{ 'list': 'ordered'}, { 'list': 'bullet' }],
            [{ 'align': [] }],
            ['link', 'image'],
            ['clean']
          ]
        }
      });
      
      if (this.postForm.content) {
        this.quillEditor.root.innerHTML = this.postForm.content;
      }
      
      this.quillEditor.on('text-change', () => {
        this.postForm.content = this.quillEditor.root.innerHTML;
      });
    },

    async createPost() {
      if (!this.postForm.title.trim()) {
        Swal.fire({
          icon: 'warning',
          title: '제목을 입력하세요',
          confirmButtonColor: '#2563eb'
        });
        return;
      }

      const content = this.quillEditor ? this.quillEditor.root.innerHTML : '';
      if (!content.trim() || content === '<p><br></p>') {
        Swal.fire({
          icon: 'warning',
          title: '내용을 입력하세요',
          confirmButtonColor: '#2563eb'
        });
        return;
      }

      // 권한 체크: 공지 등록은 admin/staff만
      const isNotice = this.postForm.isNotice && this.canCreateNotice;
      const noticeScope = isNotice ? (this.postForm.noticeScope || 'board') : null;

      try {
        const postData = {
          title: this.postForm.title.trim(),
          content: content,
          category: this.postForm.category || 'free',
          categoryText: this.getCategoryLabel(this.postForm.category || 'free'),
          authorId: this.user.uid,
          authorName: this.user.displayName || this.user.email.split('@')[0],
          created_at: serverTimestamp(),
          commentCount: 0,
          viewCount: 0,
          isNotice: isNotice || false,
          noticeScope: noticeScope
        };
        
        // 관리자가 공지사항 탭에서 작성한 경우는 전체 공지로
        if (isNotice && noticeScope === 'global') {
          postData.isImportant = true;
        }

        await addDoc(collection(db, 'posts'), postData);

        this.showPostModal = false;
        this.postForm = { id: null, title: '', content: '', category: 'free', isNotice: false, noticeScope: 'board' };
        this.quillEditor = null;

        Swal.fire({
          icon: 'success',
          title: isNotice ? '공지 등록 완료' : '등록 완료',
          timer: 1200,
          showConfirmButton: false
        });
      } catch (error) {
        console.error('Create post error:', error);
        Swal.fire({
          icon: 'error',
          title: '등록 실패',
          text: error.message,
          confirmButtonColor: '#2563eb'
        });
      }
    },

    async updatePost() {
      if (!this.postForm.title.trim()) {
        Swal.fire({
          icon: 'warning',
          title: '제목을 입력하세요',
          confirmButtonColor: '#2563eb'
        });
        return;
      }

      const content = this.quillEditor ? this.quillEditor.root.innerHTML : this.postForm.content;

      try {
        await updateDoc(doc(db, 'posts', this.postForm.id), {
          title: this.postForm.title.trim(),
          content: content,
          updated_at: serverTimestamp()
        });

        this.showPostModal = false;
        this.postForm = { id: null, title: '', content: '' };
        this.quillEditor = null;

        Swal.fire({
          icon: 'success',
          title: '수정 완료',
          timer: 1200,
          showConfirmButton: false
        });
      } catch (error) {
        Swal.fire({
          icon: 'error',
          title: '수정 실패',
          text: error.message,
          confirmButtonColor: '#2563eb'
        });
      }
    },

    async deletePost(postId) {
      const result = await Swal.fire({
        icon: 'warning',
        title: '게시글을 삭제하시겠습니까?',
        text: '삭제 후 복구할 수 없습니다.',
        showCancelButton: true,
        confirmButtonText: '삭제',
        cancelButtonText: '취소',
        confirmButtonColor: '#dc2626'
      });

      if (!result.isConfirmed) return;

      try {
        // Delete associated comments first
        const commentsQ = query(collection(db, 'posts', postId, 'comments'));
        const commentsSnap = await getDocs(commentsQ);
        const deletePromises = commentsSnap.docs.map(d => deleteDoc(doc(db, 'posts', postId, 'comments', d.id)));
        await Promise.all(deletePromises);

        // Delete post
        await deleteDoc(doc(db, 'posts', postId));

        this.showDetailModal = false;
        Swal.fire({
          icon: 'success',
          title: '삭제 완료',
          timer: 1200,
          showConfirmButton: false
        });
      } catch (error) {

        Swal.fire({
          icon: 'error',
          title: '삭제 실패',
          text: error.message,
          confirmButtonColor: '#2563eb'
        });
      }
    },

    openPostDetail(post) {
      this.goToPost(post);
    },

    loadComments(postId) {
      const isAnnouncement = this.selectedPost.isAnnouncement;
      const collectionPath = isAnnouncement ? 'announcements' : 'posts';
      
      const q = query(
        collection(db, collectionPath, postId, 'comments'),
        orderBy('created_at', 'asc')
      );

      onSnapshot(q, (snapshot) => {
        this.comments = snapshot.docs.map(d => ({
          id: d.id,
          ...d.data(),
          createdAt: d.data().created_at
        }));
      });
    },

    async addComment() {
      if (!this.newComment.trim()) return;

      const isAnnouncement = this.selectedPost.isAnnouncement;
      const collectionPath = isAnnouncement ? 'announcements' : 'posts';
      const postId = this.selectedPost.id;

      try {
        await addDoc(collection(db, collectionPath, postId, 'comments'), {
          content: this.newComment.trim(),
          authorId: this.user.uid,
          authorName: this.user.displayName || this.user.email.split('@')[0],
          created_at: serverTimestamp()
        });

        // Update comment count
        await updateDoc(doc(db, collectionPath, postId), {
          commentCount: (this.selectedPost.commentCount || 0) + 1
        });

        this.newComment = '';
      } catch (error) {
        
        Swal.fire({
          icon: 'error',
          title: '댓글 등록 실패',
          text: error.message,
          confirmButtonColor: '#2563eb'
        });
      }
    },

    async deleteComment(commentId) {
      const result = await Swal.fire({
        icon: 'warning',
        title: '댓글을 삭제하시겠습니까?',
        showCancelButton: true,
        confirmButtonText: '삭제',
        cancelButtonText: '취소',
        confirmButtonColor: '#dc2626'
      });

      if (!result.isConfirmed) return;

      const isAnnouncement = this.selectedPost.isAnnouncement;
      const collectionPath = isAnnouncement ? 'announcements' : 'posts';
      const postId = this.selectedPost.id;

      try {
        await deleteDoc(doc(db, collectionPath, postId, 'comments', commentId));

        // Update comment count
        await updateDoc(doc(db, collectionPath, postId), {
          commentCount: Math.max(0, (this.selectedPost.commentCount || 0) - 1)
        });

        Swal.fire({
          icon: 'success',
          title: '삭제 완료',
          timer: 1000,
          showConfirmButton: false
        });
      } catch (error) {

      }
    },

    canEditPost(post) {
      return post.authorId === this.user?.uid;
    },

    canDeletePost(post) {
      return post.authorId === this.user?.uid || this.userRole === 'admin';
    },

    canDeleteComment(comment) {
      return comment.authorId === this.user?.uid || this.userRole === 'admin';
    },

    stripHtml(html) {
      if (!html) return '';
      return html.replace(/<[^>]*>/g, '');
    },

    formatDate(timestamp) {
      if (!timestamp) return '-';
      const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
      return dayjs(date).format('YYYY.MM.DD HH:mm');
    },

    getInitials(name) {
      if (!name) return '?';
      return name.charAt(0).toUpperCase();
    },

    async logout() {
      await signOut(auth);
      window.location.href = 'login.html';
    },

    async loadNotifications() {
      if (!this.user) return;
      try {
        const { query, where, orderBy, onSnapshot, collection } = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js');
        this.notificationUnsubscribes.forEach((unsubscribe) => unsubscribe?.());
        this.notificationUnsubscribes = [];
        this.notificationLegacyItems = [];
        this.notificationRecipientItems = [];

        const subscribeByField = (fieldName, targetKey) => {
          const q = query(
            collection(db, 'notifications'),
            where(fieldName, '==', this.user.uid),
            where('read', '==', false),
            orderBy('created_at', 'desc')
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
      } catch (err) {
        
      }
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
        const { deleteDoc, doc } = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js');
        await deleteDoc(doc(db, 'notifications', notification.id));
        this.notifications = this.notifications.filter(n => n.id !== notification.id);
        this.unreadCount = this.notifications.length;
      } catch (err) {
        
      }
    },

    async markAllNotificationsRead() {
      try {
        const { writeBatch, doc, updateDoc } = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js');
        const batch = writeBatch(db);
        this.notifications.forEach(n => {
          const ref = doc(db, 'notifications', n.id);
          batch.update(ref, { read: true });
        });
        await batch.commit();
        this.notifications = [];
        this.unreadCount = 0;
      } catch (err) {
        
      }
    },

    async handleNotificationClick(notification) {
      try {
        const { updateDoc, doc } = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js');
        await updateDoc(doc(db, 'notifications', notification.id), { read: true });
        this.notifications = this.notifications.filter(n => n.id !== notification.id);
        this.unreadCount = this.notifications.length;
        this.notificationLegacyItems = this.notificationLegacyItems.filter(n => n.id !== notification.id);
        this.notificationRecipientItems = this.notificationRecipientItems.filter(n => n.id !== notification.id);
        this.showNotifications = false;

        const targetUrl = this.resolveNotificationUrl(notification);
        if (targetUrl) {
          window.location.href = targetUrl;
        }
      } catch (err) {
        
      }
    },

    async handleNotification(notification) {
      await this.handleNotificationClick(notification);
    },

    formatDate(timestamp) {
      if (!timestamp) return '-';
      const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
      return date.toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    },

    // Search Functions
    performSearch() {
      this.isSearching = true;
      this.currentPage = 1;
    },

    clearSearch() {
      this.searchQuery = '';
      this.isSearching = false;
      this.currentPage = 1;
    },

    // Pagination Functions
    getPageNumbers() {
      const total = this.totalPages;
      const current = this.currentPage;
      const pages = [];
      
      if (total <= 7) {
        for (let i = 1; i <= total; i++) pages.push(i);
      } else {
        if (current <= 4) {
          for (let i = 1; i <= 5; i++) pages.push(i);
          pages.push('...');
          pages.push(total);
        } else if (current >= total - 3) {
          pages.push(1);
          pages.push('...');
          for (let i = total - 4; i <= total; i++) pages.push(i);
        } else {
          pages.push(1);
          pages.push('...');
          for (let i = current - 1; i <= current + 1; i++) pages.push(i);
          pages.push('...');
          pages.push(total);
        }
      }
      return pages.filter(p => p === '...' || (p >= 1 && p <= total));
    }
  };
};
