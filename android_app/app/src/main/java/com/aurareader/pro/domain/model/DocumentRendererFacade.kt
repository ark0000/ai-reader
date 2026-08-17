package com.aurareader.pro.domain.model

import android.graphics.Bitmap

/**
 * Facade Pattern Interface
 * Hides the complexity of Android's PdfRenderer and caching strategy 
 * from the presentation layer.
 */
interface DocumentRendererFacade {
    
    /**
     * Initializes the renderer for a given file.
     */
    suspend fun openDocument(filePath: String)
    
    /**
     * Returns a rendered bitmap of a specific page.
     * Implements LRU caching under the hood to prevent OutOfMemory errors.
     */
    suspend fun renderPage(pageNumber: Int, width: Int, height: Int): Bitmap?
    
    /**
     * Closes the document and releases native resources.
     */
    fun closeDocument()
}
