package com.aurareader.pro.domain.repository

import com.aurareader.pro.domain.model.UnifiedDocument
import kotlinx.coroutines.flow.Flow

/**
 * Repository Pattern Interface
 * Defines the contract for accessing and managing local document data,
 * adhering to the Dependency Inversion Principle.
 */
interface FileRepository {
    
    /**
     * Retrieves all documents stored locally, observed as a Flow.
     */
    fun getAllDocuments(): Flow<List<UnifiedDocument>>
    
    /**
     * Gets a single document by its ID.
     */
    suspend fun getDocumentById(id: String): UnifiedDocument?
    
    /**
     * Adds a newly imported document to the local database.
     */
    suspend fun addDocument(document: UnifiedDocument)
    
    /**
     * Deletes a document from the local database and optionally the file system.
     */
    suspend fun deleteDocument(id: String, deleteFile: Boolean = false)
}
