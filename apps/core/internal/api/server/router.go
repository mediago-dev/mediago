package server

func (s *Server) registerRoutes() {
	s.engine.GET("/healthy", s.healthHandler.Check)
	s.registerSwaggerRoute()

	bridge := s.engine.Group("/api/bridge")
	{
		bridge.GET("/events", s.discoveryBridgeHandler.Events)
		bridge.POST("/discoveries/:id/start", s.discoveryBridgeHandler.Start)
		bridge.POST("/discoveries/:id/complete", s.discoveryBridgeHandler.Complete)
		bridge.POST("/discoveries/:id/fail", s.discoveryBridgeHandler.Fail)
	}

	// Video player routes (when video-root is configured)
	if s.videoHandler != nil {
		v1 := s.engine.Group("/api/v1")
		s.videoHandler.RegisterRoutes(v1)
		s.engine.GET("/videos/:id", s.videoHandler.ServeVideoByID)
	}

	api := s.engine.Group("/api")
	{
		api.POST("/tasks", s.taskHandler.Create)
		api.GET("/tasks/:id", s.taskHandler.Get)
		api.GET("/tasks", s.taskHandler.List)
		api.POST("/tasks/:id/stop", s.taskHandler.Stop)
		api.GET("/tasks/:id/logs", s.taskHandler.Logs)

		api.GET("/config", s.configHandler.GetStore)
		api.POST("/config", s.configHandler.Update)
		api.GET("/config/:key", s.configHandler.GetKey)
		api.PUT("/config/:key", s.configHandler.SetKey)

		api.GET("/events", s.eventHandler.Stream)

		// Auth
		auth := api.Group("/auth")
		{
			auth.POST("/setup", s.authHandler.Setup)
			auth.POST("/signin", s.authHandler.Signin)
			auth.GET("/status", s.authHandler.Status)
		}

		// Utility
		api.GET("/url/title", s.utilHandler.GetPageTitle)
		api.GET("/env", s.utilHandler.GetEnvPaths)
		api.POST("/sources/inspect", s.sourceHandler.Inspect)
		api.POST("/discoveries", s.discoveryHandler.Create)
		api.GET("/discoveries/:id", s.discoveryHandler.Get)
		api.POST("/discoveries/:id/cancel", s.discoveryHandler.Cancel)
		api.POST("/discoveries/:id/downloads", s.discoveryHandler.Downloads)
		api.GET("/discovery-executor/status", s.discoveryHandler.ExecutorStatus)

		docker := api.Group("/docker")
		{
			docker.GET("/status", s.dockerHandler.Status)
			docker.POST("/discoveries/:id/downloads", s.dockerHandler.DiscoveryDownloads)
			docker.POST("/sources/inspect", s.dockerHandler.InspectSources)
			docker.GET("/downloads", s.dockerHandler.List)
			docker.POST("/downloads", s.dockerHandler.Create)
			docker.GET("/downloads/active", s.dockerHandler.Active)
			docker.GET("/downloads/:id", s.dockerHandler.Get)
			docker.PUT("/downloads/:id", s.dockerHandler.Update)
			docker.DELETE("/downloads/:id", s.dockerHandler.Delete)
			docker.POST("/downloads/:id/start", s.dockerHandler.Start)
			docker.POST("/downloads/:id/stop", s.dockerHandler.Stop)
			docker.PUT("/downloads/:id/live", s.dockerHandler.UpdateLive)
			docker.GET("/downloads/:id/logs", s.dockerHandler.Logs)
		}
	}

	// Database persistence routes (only registered when database is available)
	if s.downloadHandler != nil {
		downloads := api.Group("/downloads")
		{
			downloads.POST("", s.downloadHandler.Create)
			downloads.GET("", s.downloadHandler.List)
			downloads.GET("/folders", s.downloadHandler.Folders)
			downloads.GET("/export", s.downloadHandler.Export)
			downloads.GET("/active", s.downloadHandler.Active)
			downloads.PUT("/status", s.downloadHandler.UpdateStatus)
			downloads.GET("/:id", s.downloadHandler.Get)
			downloads.PUT("/:id", s.downloadHandler.Edit)
			downloads.DELETE("/:id", s.downloadHandler.Delete)
			downloads.POST("/:id/start", s.downloadHandler.Start)
			downloads.POST("/:id/stop", s.downloadHandler.Stop)
			downloads.PUT("/:id/live", s.downloadHandler.UpdateIsLive)
			downloads.GET("/:id/logs", s.downloadHandler.Logs)
		}
	}

	if s.favoriteHandler != nil {
		favorites := api.Group("/favorites")
		{
			favorites.GET("", s.favoriteHandler.List)
			favorites.POST("", s.favoriteHandler.Create)
			favorites.POST("/:id/icon/resolve", s.favoriteHandler.ResolveIcon)
			favorites.DELETE("/:id", s.favoriteHandler.Delete)
			favorites.GET("/export", s.favoriteHandler.Export)
			favorites.POST("/import", s.favoriteHandler.Import)
		}
	}

	if s.conversionHandler != nil {
		conversions := api.Group("/conversions")
		{
			conversions.GET("", s.conversionHandler.List)
			conversions.POST("", s.conversionHandler.Create)
			conversions.DELETE("/:id", s.conversionHandler.Delete)
			conversions.GET("/:id", s.conversionHandler.Get)
			conversions.POST("/:id/start", s.conversionHandler.Start)
			conversions.POST("/:id/stop", s.conversionHandler.Stop)
		}
	}
}
